import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { MatchingPage } from '../../src/features/matching/MatchingPage'
import type { Opportunity } from '../../src/features/matching/matching-api'
import { campusRpc } from '../../src/lib/supabase/rpc'

vi.mock('../../src/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: { user: { id: 'signed-in-user' } }, loading: false }),
}))
vi.mock('../../src/features/profiles/profile-api', () => ({
  useUniversities: () => ({ data: [{ id: 'test-university', name: '테스트대학교' }] }),
}))
vi.mock('../../src/lib/supabase/client', () => ({ isSupabaseConfigured: true }))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: vi.fn() }))
const rpc = vi.mocked(campusRpc)
beforeEach(() => {
  rpc.mockReset()
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
}

function page(path: string) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <MatchingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

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

it('공개 원본을 선택해 리부트 모집글을 올리면 내 모집글로 이동한다', async () => {
  rpc.mockImplementation(async (name) => {
    if (name === 'list_matching_reboot_sources')
      return [{ id: 'source-id', title: '기존 공개 프로젝트' }]
    if (name === 'create_matching_opportunity') return 'reboot-id'
    if (name === 'list_matching_opportunities') return []
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page('/opportunities/new')
  await user.selectOptions(screen.getByLabelText('모집 유형'), 'reboot')
  const submit = screen.getByRole('button', { name: '모집글 올리기' })
  expect(submit).toBeDisabled()
  await user.selectOptions(await screen.findByLabelText('리부트할 공개 프로젝트'), 'source-id')
  await user.type(screen.getByLabelText('모집 제목'), '동아리 지도 리부트')
  await user.type(screen.getByLabelText('모집 소개'), '우리의 새 프로젝트 방향을 설명합니다.')
  await user.type(screen.getByLabelText('모집 역할'), '개발')
  await user.click(submit)
  expect(rpc).toHaveBeenCalledWith(
    'create_matching_opportunity',
    expect.objectContaining({ p_type: 'reboot', p_source_project_id: 'source-id', p_gap: null }),
  )
  expect(await screen.findByRole('heading', { name: '내 모집글' })).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith(
    'list_matching_opportunities',
    expect.objectContaining({ p_mine: true }),
  )
})
