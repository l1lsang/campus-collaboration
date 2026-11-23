import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MatchingPage } from '../../src/features/matching/MatchingPage'
import type { Opportunity } from '../../src/features/matching/matching-api'
import { campusRpc } from '../../src/lib/supabase/rpc'
import { matchingAuth, matchingTransport, schoolAccount } from './matching-test-transport'

vi.mock('../../src/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: { user: { id: account.id } }, loading: false }),
}))
vi.mock('../../src/features/profiles/profile-api', () => ({
  useUniversities: () => ({ data: [{ id: 'test-university', name: '테스트대학교' }] }),
}))
const storage = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), download: vi.fn() }))
const account = matchingAuth()
vi.mock('../../src/lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({ auth: account.auth, storage: { from: () => storage } }),
}))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: vi.fn() }))
const rpc = vi.mocked(campusRpc)
beforeEach(() => {
  sessionStorage.clear()
  account.set(schoolAccount)
  rpc.mockReset()
  storage.upload.mockReset()
  storage.remove.mockReset()
  storage.download.mockReset()
  matchingTransport(rpc, storage)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const opportunity: Opportunity = {
  id: 'opportunity-id',
  type: 'idea',
  title: '동아리 지도 만들기',
  description: '동아리 탐색을 돕는 지도를 만들고 싶어요.',
  roles: ['개발'],
  skills: ['React'],
  university_name: null,
  major: null,
  gap: '프론트엔드 검증',
  source_project_id: null,
  competition: null,
  format: null,
  deadline: null,
  is_mine: false,
  is_open: true,
  request_status: null,
  project_id: null,
  reboot_prior_work: null,
  reboot_changes: null,
  reboot_attachment: null,
}

function page(
  path: string,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MatchingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

it('원본 목록을 다시 불러오지 못해도 선택한 원본을 등록 요청에서 빼지 않는다', async () => {
  let failSources = false
  rpc.mockImplementation(async (name) => {
    if (name === 'list_matching_reboot_sources') {
      if (failSources) throw new Error('network')
      return [{ id: 'source-id', title: '기존 공개 프로젝트' }]
    }
    if (name === 'begin_matching_reboot') return null
    if (name === 'list_matching_reboot_cleanup') return []
    if (name === 'create_matching_opportunity') return 'reboot-id'
    if (name === 'list_matching_opportunities') return []
    throw new Error(`unexpected rpc: ${name}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const user = page('/opportunities/new', client)
  await user.selectOptions(screen.getByLabelText('모집 유형'), 'reboot')
  await user.click(screen.getByText('공개 원본 연결 (선택)'))
  await user.selectOptions(await screen.findByLabelText('리부트할 공개 프로젝트'), 'source-id')
  await user.type(screen.getByLabelText('모집 제목'), '동아리 지도 리부트')
  await user.type(screen.getByLabelText('모집 소개'), '우리의 새 프로젝트 방향을 설명합니다.')
  await user.type(screen.getByLabelText('모집 역할'), '개발')
  await user.type(screen.getByLabelText('이전까지 해 둔 작업'), '동아리 목록 초안을 만들었습니다.')
  await user.type(screen.getByLabelText('멈춘 이유와 바꿀 점'), '역할을 조정해 다시 시작합니다.')
  failSources = true
  await act(() =>
    client.invalidateQueries({ queryKey: ['account', 'signed-in-user', 'matching', 'sources'] }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('리부트 원본을 불러오지 못했습니다.')
  expect(screen.getByLabelText('리부트할 공개 프로젝트')).toHaveValue('source-id')
  await user.click(screen.getByRole('button', { name: '모집글 올리기' }))
  expect(rpc).toHaveBeenCalledWith(
    'create_matching_opportunity',
    expect.objectContaining({ p_source_project_id: 'source-id' }),
  )
})

it('목록 요청이 늦거나 실패하면 로딩과 다시 시도 버튼을 보여 준다', async () => {
  let reject: (reason: Error) => void = () => undefined
  rpc
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    .mockResolvedValueOnce([opportunity])
  const user = page('/opportunities/ideas')
  expect(screen.getByRole('status')).toHaveTextContent('모집글을 불러오는 중')
  reject(new Error('network'))
  const error = await screen.findByRole('alert')
  await user.click(within(error).getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('heading', { name: opportunity.title })).toBeInTheDocument()
})

it('지원 실패 시 입력을 보존하고, 성공한 뒤 서버의 대기 상태를 표시한다', async () => {
  let submitted = false
  let fail = true
  rpc.mockImplementation(async (name) => {
    if (name === 'submit_matching_request') {
      if (fail) throw new Error('MATCHING_INVALID_TIMEZONE')
      submitted = true
      return 'request-id'
    }
    if (name === 'list_matching_opportunities')
      return [{ ...opportunity, request_status: submitted ? 'pending' : null }]
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page('/opportunities')
  await user.click(await screen.findByRole('button', { name: '지원하기' }))
  const message = screen.getByLabelText('지원 메시지')
  await user.type(message, '동아리 지도에 참여하고 싶습니다.')
  await user.click(screen.getByRole('button', { name: '지원 보내기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Asia/Seoul')
  expect(message).toHaveValue('동아리 지도에 참여하고 싶습니다.')
  fail = false
  await user.click(screen.getByRole('button', { name: '지원 보내기' }))
  expect(await screen.findByText('검토 중')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '지원하기' })).not.toBeInTheDocument()
})

it('받은 지원을 수락하면 서버에서 생성된 팀 프로젝트로 갈 수 있다', async () => {
  let accepted = false
  rpc.mockImplementation(async (name, args) => {
    if (name === 'decide_matching_request') {
      accepted = true
      return 'private-project-id'
    }
    if (name === 'list_matching_requests')
      return args?.p_received
        ? [
            {
              id: 'request-id',
              opportunity_title: opportunity.title,
              type: 'idea',
              message: '참여를 원합니다',
              applicant_nickname: '테스터',
              selected_role: null,
              timezone: null,
              created_at: '2026-11-23T03:00:00Z',
              status: accepted ? 'accepted' : 'pending',
              project_id: accepted ? 'private-project-id' : null,
            },
          ]
        : []
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page('/opportunities/requests')
  await user.click(screen.getByRole('button', { name: '받은 지원' }))
  await user.click(await screen.findByRole('button', { name: '수락' }))
  expect(rpc).toHaveBeenCalledWith('decide_matching_request', {
    p_request_id: 'request-id',
    p_accept: true,
  })
  expect(await screen.findByRole('link', { name: '팀 프로젝트 열기' })).toHaveAttribute(
    'href',
    '/projects/private-project-id',
  )
})

it('공개 원본과 첨부 없이 이전 작업과 변경 계획만 작성해 리부트 모집글을 올린다', async () => {
  rpc.mockImplementation(async (name) => {
    if (name === 'list_matching_reboot_sources')
      return [{ id: 'source-id', title: '기존 공개 프로젝트' }]
    if (name === 'begin_matching_reboot') return null
    if (name === 'list_matching_reboot_cleanup') return []
    if (name === 'create_matching_opportunity') return 'reboot-id'
    if (name === 'list_matching_opportunities') return []
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page('/opportunities/new')
  await user.selectOptions(screen.getByLabelText('모집 유형'), 'reboot')
  const submit = screen.getByRole('button', { name: '모집글 올리기' })
  expect(submit).toBeEnabled()
  await user.type(screen.getByLabelText('모집 제목'), '동아리 지도 리부트')
  await user.type(screen.getByLabelText('모집 소개'), '우리의 새 프로젝트 방향을 설명합니다.')
  await user.type(screen.getByLabelText('모집 역할'), '개발')
  const prior = screen.getByLabelText('이전까지 해 둔 작업')
  const changes = screen.getByLabelText('멈춘 이유와 바꿀 점')
  expect(prior).toBeRequired()
  expect(changes).toBeRequired()
  await user.type(prior, '동아리 목록 초안을 만들었습니다.')
  await user.type(changes, '데이터가 부족해 멈췄고 이번에는 직접 수집합니다.')
  await user.click(submit)
  expect(rpc).toHaveBeenCalledWith(
    'create_matching_opportunity',
    expect.objectContaining({
      p_type: 'reboot',
      p_source_project_id: null,
      p_gap: null,
      p_reboot_prior_work: '동아리 목록 초안을 만들었습니다.',
      p_reboot_changes: '데이터가 부족해 멈췄고 이번에는 직접 수집합니다.',
    }),
  )
  expect(await screen.findByRole('heading', { name: '내 모집글' })).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith(
    'list_matching_opportunities',
    expect.objectContaining({ p_mine: true }),
  )
})

it('첨부 업로드 후 등록에 실패하면 Storage 파일을 지우고 입력을 유지한다', async () => {
  const file = new File(['%PDF-1.7'], '작업 로그.pdf', { type: 'application/pdf' })
  const path = 'signed-in-user/opaque-request-id'
  const calls: string[] = []
  storage.upload.mockImplementation(async () => {
    calls.push('upload')
    return { error: null }
  })
  storage.remove.mockImplementation(async () => {
    calls.push('remove')
    return { error: null }
  })
  rpc.mockImplementation(async (name) => {
    switch (name) {
      case 'list_matching_reboot_sources':
      case 'list_matching_reboot_cleanup':
        return []
      case 'begin_matching_reboot':
        calls.push('reserve')
        return path
      case 'create_matching_opportunity':
        calls.push('publish')
        throw new Error('MATCHING_REBOOT_SOURCE_UNAVAILABLE')
      case 'cancel_matching_reboot_attempt':
        calls.push('cancel')
        return { object_path: path }
      default:
        throw new Error(`unexpected rpc: ${name}`)
    }
  })
  const user = page('/opportunities/new')
  await user.selectOptions(screen.getByLabelText('모집 유형'), 'reboot')
  const title = screen.getByLabelText('모집 제목')
  await user.type(title, '동아리 지도 리부트')
  await user.type(screen.getByLabelText('모집 소개'), '우리의 새 프로젝트 방향을 설명합니다.')
  await user.type(screen.getByLabelText('모집 역할'), '개발')
  await user.type(screen.getByLabelText('이전까지 해 둔 작업'), '동아리 목록 초안을 만들었습니다.')
  await user.type(
    screen.getByLabelText('멈춘 이유와 바꿀 점'),
    '데이터가 부족해 멈췄고 이번에는 직접 수집합니다.',
  )
  const picker = screen.getByLabelText('작업 자료 첨부 (선택)')
  expect(picker).toHaveAccessibleDescription(/학교 Google 계정/)
  await user.upload(picker, file)
  await user.click(screen.getByRole('button', { name: '모집글 올리기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('공개 프로젝트')
  expect(calls).toEqual(['reserve', 'upload', 'publish', 'cancel', 'remove'])
  expect(storage.upload).toHaveBeenCalledWith(path, expect.any(ArrayBuffer), expect.any(Headers))
  expect(storage.upload.mock.calls[0][2].get('x-upsert')).toBe('false')
  expect(storage.remove).toHaveBeenCalledWith([path])
  expect(title).toHaveValue('동아리 지도 리부트')
  expect(picker).toHaveProperty('files', expect.objectContaining({ 0: file }))
})

async function fillReboot(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('모집 유형'), 'reboot')
  for (const label of [
    '모집 제목',
    '모집 소개',
    '모집 역할',
    '이전까지 해 둔 작업',
    '멈춘 이유와 바꿀 점',
  ]) {
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: '입력한 비공개 테스트 자료' },
    })
  }
}

it('예약 응답 전에 계정이 바뀌면 이전 계정의 파일이나 모집글을 보내지 않는다', async () => {
  const reservation = Promise.withResolvers<string>()
  rpc.mockImplementation(async (name) => {
    if (name === 'list_matching_reboot_sources' || name === 'list_matching_reboot_cleanup')
      return []
    if (name === 'begin_matching_reboot') return reservation.promise
    if (name === 'create_matching_opportunity') return 'listing-id'
    if (name === 'list_matching_opportunities') return []
    throw new Error(`unexpected rpc: ${name}`)
  })
  storage.upload.mockResolvedValue({ error: null })
  const user = page('/opportunities/new')
  await fillReboot(user)
  await user.upload(
    screen.getByLabelText('작업 자료 첨부 (선택)'),
    new File(['%PDF-1.7'], '작업 로그.pdf', { type: 'application/pdf' }),
  )
  await user.click(screen.getByRole('button', { name: '모집글 올리기' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('begin_matching_reboot', expect.anything()))
  await act(async () => {
    account.set('other-user', undefined, 'SIGNED_IN')
    reservation.resolve('signed-in-user/opaque-request')
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('로그인 계정이 변경되어')
  expect(storage.upload).not.toHaveBeenCalled()
  expect(rpc.mock.calls.map(([name]) => name)).not.toContain('create_matching_opportunity')
  expect(rpc.mock.calls.map(([name]) => name)).not.toContain('cancel_matching_reboot_attempt')
}, 15_000)

it('새로고침 후 새 제출 대신 확정되지 않은 이전 요청을 확인한다', async () => {
  let offline = true
  rpc.mockImplementation(async (name) => {
    if (
      [
        'list_matching_reboot_sources',
        'list_matching_reboot_cleanup',
        'list_matching_opportunities',
      ].includes(name)
    )
      return []
    if (name === 'begin_matching_reboot') return null
    if (
      name === 'create_matching_opportunity' ||
      (name === 'cancel_matching_reboot_attempt' && offline)
    )
      throw new Error('offline')
    if (name === 'cancel_matching_reboot_attempt') return { opportunity_id: 'existing-listing' }
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page('/opportunities/new')
  await fillReboot(user)
  await user.click(screen.getByRole('button', { name: '모집글 올리기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('등록 결과를 확인하지 못했습니다.')
  const requestId = rpc.mock.calls.find(([name]) => name === 'begin_matching_reboot')?.[1]
    ?.p_request_id
  expect(requestId).toEqual(expect.any(String))

  await user.click(screen.getByRole('link', { name: '전체 모집' }))
  await user.click(screen.getByRole('link', { name: '모집글 등록' }))
  expect(screen.queryByRole('button', { name: '모집글 올리기' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '이전 등록 결과 확인' })).toBeEnabled()

  cleanup()
  const refreshed = page('/opportunities/new')
  offline = false
  await refreshed.click(screen.getByRole('button', { name: '이전 등록 결과 확인' }))
  expect(await screen.findByText('모집글을 등록했습니다.')).toBeInTheDocument()
  expect(rpc.mock.calls.filter(([name]) => name === 'cancel_matching_reboot_attempt')).toEqual([
    ['cancel_matching_reboot_attempt', { p_request_id: requestId }],
    ['cancel_matching_reboot_attempt', { p_request_id: requestId }],
  ])
  expect(rpc.mock.calls.filter(([name]) => name === 'begin_matching_reboot')).toHaveLength(1)
  expect(rpc.mock.calls.filter(([name]) => name === 'create_matching_opportunity')).toHaveLength(1)
  expect(sessionStorage.length).toBe(0)
})

it('다른 계정에는 이전 작성 내용과 대기 요청이 보이지 않는다', async () => {
  rpc.mockImplementation(async (name) => {
    if (
      [
        'list_matching_reboot_sources',
        'list_matching_reboot_cleanup',
        'list_matching_opportunities',
      ].includes(name)
    )
      return []
    if (name === 'begin_matching_reboot') return 'opaque-path'
    if (name === 'create_matching_opportunity' && account.id !== schoolAccount) return 'new-listing'
    if (name === 'create_matching_opportunity' || name === 'cancel_matching_reboot_attempt')
      throw new Error('lost reply')
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page('/opportunities/new')
  await fillReboot(user)
  await user.upload(
    screen.getByLabelText('작업 자료 첨부 (선택)'),
    new File(['%PDF-1.7'], '보관하면 안 되는 파일.pdf', { type: 'application/pdf' }),
  )
  await user.click(screen.getByRole('button', { name: '모집글 올리기' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('등록 결과를 확인하지 못했습니다.')
  const previousRequest = rpc.mock.calls.find(([name]) => name === 'begin_matching_reboot')?.[1]
    ?.p_request_id
  expect(previousRequest).toEqual(expect.any(String))
  expect(Object.values(sessionStorage)).toEqual([previousRequest])

  cleanup()
  account.set('different-account', undefined, 'SIGNED_IN')
  const other = page('/opportunities/new')
  expect(screen.queryByRole('button', { name: '이전 등록 결과 확인' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('모집 제목')).toHaveValue('')
  await fillReboot(other)
  await other.click(screen.getByRole('button', { name: '모집글 올리기' }))
  expect(await screen.findByText('모집글을 등록했습니다.')).toBeInTheDocument()
  expect(rpc.mock.calls.filter(([name]) => name === 'cancel_matching_reboot_attempt')).toEqual([
    ['cancel_matching_reboot_attempt', { p_request_id: previousRequest }],
  ])
  const reserves = rpc.mock.calls.filter(([name]) => name === 'begin_matching_reboot')
  expect(reserves).toHaveLength(2)
  expect(reserves[1][1]?.p_request_id).not.toBe(previousRequest)
  expect(Object.values(sessionStorage)).toEqual([previousRequest])

  cleanup()
  account.set(schoolAccount, undefined, 'SIGNED_IN')
  page('/opportunities/new')
  expect(screen.getByRole('button', { name: '이전 등록 결과 확인' })).toBeEnabled()
})

it('원본 없는 리부트 카드에서 작업 설명과 첨부 다운로드를 표시한다', async () => {
  rpc.mockResolvedValue([
    {
      ...opportunity,
      type: 'reboot',
      gap: null,
      reboot_prior_work: '작업 초안',
      reboot_changes: '중단 이유와 변경 계획',
      reboot_attachment: {
        filename: '작업 로그.pdf',
        size: 128,
        path: 'owner/key',
        mime: 'application/pdf',
      },
    },
  ])
  page('/opportunities/reboots')
  expect(await screen.findByText('작업 초안')).toBeInTheDocument()
  expect(screen.getByText('중단 이유와 변경 계획')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '작업 로그.pdf 다운로드' })).toBeInTheDocument()
  expect(screen.queryByText(/공개 원본을 더 이상/)).not.toBeInTheDocument()
})
