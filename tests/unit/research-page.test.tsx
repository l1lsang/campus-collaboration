import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthPage } from '../../src/features/auth/AuthPage'
import { AuthProvider } from '../../src/features/auth/auth-provider'
import { clearAuthReturnPath, readAuthReturnPath } from '../../src/features/auth/return-path'
import { ResearchPage } from '../../src/features/research/ResearchPage'
import { safeTestUrl } from '../../src/features/research/research-api'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: null as null | { id: string },
  projects: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
  verification: vi.fn(),
  realAuth: false,
}))
const surveyCode = 'ecc52253-d1be-43a2-8328-abeba7aedde5'
vi.mock('../../src/lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: {
      signInWithOAuth: mocks.signIn,
      signOut: mocks.signOut,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    rpc: mocks.verification,
  }),
}))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: mocks.rpc }))
vi.mock('../../src/features/auth/auth-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/auth/auth-provider')>()
  return {
    ...actual,
    useAuth: function useResearchTestAuth() {
      const auth = actual.useAuth()
      return mocks.realAuth
        ? auth
        : {
            ...auth,
            session: mocks.user && { user: mocks.user },
            loading: false,
            status: 'verified',
          }
    },
  }
})
vi.mock('../../src/features/projects/project-api', () => ({
  useMyProjects: (...args: unknown[]) => mocks.projects(...args),
}))

function open(path: string) {
  const route = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/research/*" element={<ResearchPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
      </Routes>
    </MemoryRouter>
  )
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {mocks.realAuth ? <AuthProvider>{route}</AuthProvider> : route}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.user = null
  mocks.realAuth = false
  mocks.rpc.mockReset()
  mocks.signIn.mockReset().mockResolvedValue({ error: null })
  mocks.signOut.mockReset()
  mocks.verification.mockReset().mockResolvedValue({ data: 'school', error: null })
  mocks.onAuthStateChange.mockReset().mockImplementation((callback) => {
    callback('INITIAL_SESSION', { user: { id: 'tester' }, access_token: 'test-session' })
    mocks.signOut.mockImplementation(async () => {
      callback('SIGNED_OUT', null)
      return { error: null }
    })
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  clearAuthReturnPath()
  mocks.projects.mockReset().mockReturnValue({ data: [], isPending: false, isError: false })
})
afterEach(cleanup)

it.each(['/research', '/research/new', '/research/mine', '/research/credits'])(
  'Google 로그인 시작 전에 %s를 검증된 복귀 경로로 저장한다',
  async (path) => {
    mocks.rpc.mockResolvedValue([])
    open(path)
    fireEvent.click(await screen.findByRole('link', { name: '로그인' }))
    fireEvent.click(await screen.findByRole('button', { name: '학교 Google 계정으로 계속하기' }))
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce())
    expect(readAuthReturnPath()).toBe(path)
  },
)

it('학교 인증이 취소된 세션은 로그아웃 전 로그인 경로로 보내지 않는다', async () => {
  mocks.realAuth = true
  mocks.rpc.mockRejectedValue({ message: 'VERIFIED_UNIVERSITY_REQUIRED' })
  open('/research/mine')

  const logout = await screen.findByRole('button', { name: '로그아웃' })
  expect(screen.queryByRole('link', { name: /로그인/ })).not.toBeInTheDocument()
  mocks.signOut.mockResolvedValueOnce({ error: new Error('network') })
  fireEvent.click(logout)
  expect(await screen.findByText('로그아웃하지 못했습니다. 다시 시도해 주세요.')).toBeVisible()
  expect(screen.queryByRole('link', { name: /로그인/ })).not.toBeInTheDocument()

  fireEvent.click(logout)
  const login = await screen.findByRole('link', { name: '로그인' })
  expect(mocks.signOut).toHaveBeenLastCalledWith({ scope: 'local' })
  expect(login).toHaveAttribute('href', '/login')
  fireEvent.click(login)
  fireEvent.click(await screen.findByRole('button', { name: '학교 Google 계정으로 계속하기' }))
  await waitFor(() => expect(mocks.signIn).toHaveBeenCalledOnce())
  expect(readAuthReturnPath()).toBe('/research/mine')
})

it('참여 신청 중 학교 인증 오류를 받아도 다시 확인하고 실제 로그인 화면을 열 수 있다', async () => {
  mocks.realAuth = true
  mocks.verification
    .mockResolvedValueOnce({ data: 'school', error: null })
    .mockResolvedValueOnce({ data: null, error: null })
  mocks.rpc.mockImplementation((name: string) => {
    if (name === 'list_research_tests')
      return [
        { id: 'survey', title: '설문 모집', kind: 'survey', capacity: 1, slots_left: 1, reward: 1 },
      ]
    if (name === 'my_research_work') return { organized: [], participating: [] }
    throw { message: 'VERIFIED_UNIVERSITY_REQUIRED' }
  })
  open('/research')

  fireEvent.click(await screen.findByRole('button', { name: '참여 신청' }))
  fireEvent.click(await screen.findByRole('button', { name: '학교 인증 다시 확인' }))
  fireEvent.click(await screen.findByRole('link', { name: '로그인' }))
  fireEvent.click(await screen.findByRole('button', { name: '학교 Google 계정으로 계속하기' }))
  expect(mocks.verification).toHaveBeenCalledTimes(2)
  expect(readAuthReturnPath()).toBe('/research')
})

it.each([
  'https://example.org\\forms',
  'https://forms.gle/line\nfeed',
  'https://forms.gle:99999/x',
  'https://127.0.0.1/form',
  'https://127.1/form',
  'https://１２７.０.０.１/form',
  'https://0177.0.0.1/form',
  'https://0x7f.0x1/form',
  'https://2130706433/form',
  'https://forms.123/form',
  'https://[::1]/form',
  'https://sub.localhost/form',
  'https://sub.ｌｏｃａｌｈｏｓｔ/form',
  'https://-form.example/form',
  'https://form-.example/form',
  'https://forms.gle./form',
  'https://%66orms.gle/form',
  'https://account@예시.한국/form',
  'https://%EC%98%88%EC%8B%9C.한국/form',
  'https://xn--a.example/form',
  'https://forms.gle/\uFEFFform',
])('정규화로 의미가 바뀌거나 유효하지 않은 외부 링크를 거절한다: %s', (url) =>
  expect(safeTestUrl(url)).toBeNull(),
)

it.each([
  'HTTPS://docs.google.com:443/forms/d/e/sample/viewform?x=1#entry',
  'https://form.naver.com/response/%ED%95%9C',
  'https://3form.example:65535/한글',
  'https://xn--vv4b11d.xn--3e0b707e/form',
  'https://xn--bcher-kva.example/form',
])('허용되는 DNS HTTPS 주소는 게시 RPC에 같은 값으로 전달할 수 있다: %s', (url) =>
  expect(safeTestUrl(url)).toBe(url),
)

it('국제화 도메인의 호스트만 게시 RPC용 A-label로 변환한다', () => {
  expect(safeTestUrl('HTTPS://예시.한국:443/한글?x=1#응답')).toBe(
    'HTTPS://xn--vv4b11d.xn--3e0b707e:443/한글?x=1#응답',
  )
})

it('진행자는 확인하지 못한 설문 신고를 거절하고 남은 예약만 환급한다', async () => {
  mocks.user = { id: 'organizer' }
  let rejected = false
  let closed = false
  mocks.rpc.mockImplementation((name: string) => {
    if (name === 'reject_research_survey_completion') rejected = true
    if (name === 'close_research_test') closed = true
    if (name !== 'my_research_work') return null
    return {
      participating: [],
      organized: [
        {
          id: 'survey',
          kind: 'survey',
          title: '학교 생활 설문',
          capacity: 2,
          slots_left: 0,
          reward: 1,
          reserved_remaining: closed ? 0 : 1,
          status: closed ? 'closed' : 'open',
          participants: [
            { id: 'paid', nickname: '지급 대상', feedback: null, status: 'confirmed' },
            {
              id: 'claim',
              nickname: '확인 대상',
              feedback: null,
              confirmation_code: surveyCode,
              status: rejected ? 'rejected' : 'submitted',
            },
          ],
        },
      ],
    }
  })
  open('/research/mine')

  expect(await screen.findByText('응답 완료 신고 · 확인 대기')).toBeVisible()
  expect(screen.getByText(surveyCode)).toBeVisible()
  expect(screen.getByText(/외부 폼에서 해당 참여의 확인 코드를 직접 대조/)).toBeVisible()
  expect(screen.queryByRole('button', { name: '모집 종료' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '응답 완료 거절' }))
  expect(await screen.findByText('응답 완료 거절 · 보상 없음')).toBeVisible()
  expect(mocks.rpc).toHaveBeenCalledWith('reject_research_survey_completion', {
    p_participation_id: 'claim',
  })
  expect(screen.getByText(/예약 1 크레딧/)).toBeVisible()
  expect(screen.getByText('보상 지급 완료')).toBeVisible()
  expect(screen.queryByRole('button', { name: /크레딧 지급/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '모집 종료' }))
  fireEvent.click(screen.getByRole('button', { name: '종료하고 환급' }))
  expect(await screen.findByText(/모집 종료.*예약 0 크레딧/)).toBeVisible()
  expect(mocks.rpc).toHaveBeenCalledWith('close_research_test', { p_test_id: 'survey' })
})

it('거절된 참여는 크레딧 미지급으로 표시하고 다시 신고할 수 없다', async () => {
  mocks.user = { id: 'tester' }
  mocks.rpc.mockResolvedValue({
    organized: [],
    participating: [
      {
        id: 'claim',
        test_id: 'survey',
        kind: 'survey',
        title: '학교 생활 설문',
        description: '설문에 응답해 주세요.',
        test_status: 'open',
        test_url: null,
        status: 'rejected',
        reward: 1,
      },
    ],
  })
  open('/research/mine')

  expect(await screen.findByText('응답 완료 거절 · 보상 없음')).toBeVisible()
  expect(screen.queryByText(/참여 보상 1 크레딧/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '응답 완료 알리기' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /외부 설문 열기/ })).not.toBeInTheDocument()
})

it('외부 설문은 새 탭에서 열리고 별도 확인 전까지 완료가 기록되지 않는다', async () => {
  mocks.user = { id: 'tester' }
  mocks.rpc.mockImplementation((name: string) =>
    name === 'my_research_work'
      ? {
          organized: [],
          participating: [
            {
              id: 'entry',
              test_id: 'survey',
              kind: 'survey',
              title: '학교 생활 설문',
              description: '외부 폼에서 설문에 응답해 주세요.',
              reward: 1,
              test_status: 'open',
              test_url: 'https://form.naver.com/response/sample',
              confirmation_code: surveyCode,
              status: 'applied',
            },
          ],
        }
      : null,
  )
  open('/research/mine')

  const link = await screen.findByRole('link', { name: '외부 설문 열기 (새 탭)' })
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link).toHaveAttribute('href', 'https://form.naver.com/response/sample')
  expect(screen.getByText(surveyCode)).toBeVisible()
  expect(screen.getByText(/외부 폼의 ‘참여 확인 코드’ 질문에 위 코드를 입력/)).toBeVisible()
  expect(screen.getByText(/자동으로 검증하지 않습니다/)).toBeVisible()
  expect(screen.getByText(/form\.naver\.com/)).toBeVisible()
  link.addEventListener('click', (event) => event.preventDefault())
  fireEvent.click(link)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('my_research_work')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

  const report = screen.getByRole('button', { name: '응답 완료 알리기' })
  expect(report).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '외부 폼에서 응답을 제출했습니다.' }))
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('my_research_work')
  fireEvent.click(report)
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith('submit_research_survey_completion', {
      p_test_id: 'survey',
    }),
  )
})

it('공개 목록에서 외부 설문을 식별하되 응답 링크는 표시하지 않는다', async () => {
  mocks.rpc.mockResolvedValue([
    {
      id: 'survey',
      kind: 'survey',
      title: '독립 설문 모집',
      description: '설문 설명을 읽어 주세요.',
      capacity: 3,
      slots_left: 2,
      reward: 1,
      test_url: 'https://forms.gle/sample123',
    },
  ])
  open('/research')

  expect(await screen.findByText('외부 설문', { exact: true })).toBeVisible()
  expect(screen.queryByRole('link', { name: /설문 열기/ })).not.toBeInTheDocument()
})

it('소유한 프로젝트 없이 외부 설문을 선택해 크레딧을 예약하고 게시한다', async () => {
  mocks.user = { id: 'organizer' }
  mocks.rpc.mockImplementation((name: string) => {
    if (name === 'my_research_credits') return { available: 3, reserved: 0, entries: [] }
    if (name === 'my_research_work') return { organized: [], participating: [] }
    return 'survey'
  })
  open('/research/new')

  fireEvent.click(await screen.findByRole('radio', { name: '외부 설문' }))
  expect(screen.getByText(/외부 폼에 ‘참여 확인 코드’ 필수 질문을 추가/)).toBeVisible()
  expect(screen.queryByRole('combobox', { name: '프로젝트 (선택)' })).not.toBeRequired()
  fireEvent.change(screen.getByRole('textbox', { name: '모집 제목' }), {
    target: { value: '학교 생활 설문' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '공개 소개 및 참여 안내' }), {
    target: { value: '외부 폼에서 설문에 응답해 주세요.' },
  })
  const url = screen.getByRole('textbox', { name: '설문 응답 링크 (HTTPS)' })
  fireEvent.change(url, { target: { value: 'https://예시.한국/form' } })
  expect(url).toBeValid()
  fireEvent.click(screen.getByRole('button', { name: '크레딧 예약하고 게시' }))

  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith('publish_research_survey', {
      p_project_id: null,
      p_request_id: expect.any(String),
      p_title: '학교 생활 설문',
      p_description: '외부 폼에서 설문에 응답해 주세요.',
      p_test_url: 'https://xn--vv4b11d.xn--3e0b707e/form',
      p_capacity: 1,
      p_reward: 1,
    }),
  )
  expect(await screen.findByRole('heading', { name: '내 리서치' })).toBeVisible()
})

it.each([
  ['프로젝트 테스트', '내 프로젝트', '테스트 링크 (HTTPS)', 'publish_research_test'],
  ['외부 설문', '프로젝트 (선택)', '설문 응답 링크 (HTTPS)', 'publish_research_survey'],
])('%s 등록 시 소유한 프로젝트만 연결할 수 있다', async (kind, label, urlLabel, rpc) => {
  mocks.user = { id: 'organizer' }
  mocks.projects.mockReturnValue({
    data: [
      { id: 'owned', title: '내 소유 프로젝트', membership_role: 'owner' },
      { id: 'joined', title: '참여한 프로젝트', membership_role: 'member' },
    ],
    isPending: false,
    isError: false,
  })
  mocks.rpc.mockImplementation((name: string) => {
    if (name === 'my_research_credits') return { available: 3, reserved: 0, entries: [] }
    if (name === 'my_research_work') return { organized: [], participating: [] }
    return 'recruitment'
  })
  open('/research/new')

  fireEvent.click(await screen.findByRole('radio', { name: kind }))
  expect(screen.queryByRole('option', { name: '참여한 프로젝트' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: 'owned' } })
  fireEvent.change(screen.getByRole('textbox', { name: '모집 제목' }), {
    target: { value: '프로젝트 리서치' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '공개 소개 및 참여 안내' }), {
    target: { value: '안내에 따라 참여해 주세요.' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: urlLabel }), {
    target: { value: 'https://form.naver.com/response/sample' },
  })
  fireEvent.click(screen.getByRole('button', { name: '크레딧 예약하고 게시' }))

  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, expect.objectContaining({ p_project_id: 'owned' })),
  )
  expect(await screen.findByRole('heading', { name: '내 리서치' })).toBeVisible()
})

it('공개 모집은 비회원도 보지만 신청이나 테스트 링크는 노출되지 않는다', async () => {
  mocks.rpc.mockResolvedValue([
    {
      id: 'test',
      title: '앱 사용성 조사',
      description: '설명을 읽어 주세요.',
      capacity: 3,
      slots_left: 2,
      reward: 1,
    },
  ])
  open('/research')

  expect(await screen.findByRole('heading', { name: '앱 사용성 조사' })).toBeVisible()
  expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
  expect(screen.queryByRole('button', { name: '참여 신청' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '테스트 열기' })).not.toBeInTheDocument()
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_research_tests')
})

it('테스트 링크를 열어도 제출되지 않고 직접 입력한 피드백만 전달된다', async () => {
  mocks.user = { id: 'tester' }
  mocks.rpc.mockImplementation((name: string) =>
    name === 'my_research_work'
      ? {
          organized: [],
          participating: [
            {
              id: 'entry',
              test_id: 'test',
              title: '앱 사용성 조사',
              description: '앱을 사용해 보세요.',
              reward: 1,
              test_status: 'open',
              test_url: 'https://xn--bcher-kva.example/test',
              status: 'applied',
            },
          ],
        }
      : null,
  )
  open('/research/mine')

  const link = await screen.findByRole('link', { name: '테스트 열기' })
  expect(link).toHaveAttribute('href', 'https://xn--bcher-kva.example/test')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  link.addEventListener('click', (event) => event.preventDefault())
  fireEvent.click(link)
  expect(mocks.rpc).not.toHaveBeenCalledWith('submit_research_feedback', expect.anything())

  const submit = screen.getByRole('button', { name: '피드백 제출' })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: '피드백' }), {
    target: { value: '처음 화면에서 버튼을 찾기 어려웠습니다.' },
  })
  fireEvent.click(submit)
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith('submit_research_feedback', {
      p_test_id: 'test',
      p_feedback: '처음 화면에서 버튼을 찾기 어려웠습니다.',
    }),
  )
})

it('진행자는 제출된 피드백을 본 후 직접 보상을 지급한다', async () => {
  mocks.user = { id: 'organizer' }
  mocks.rpc.mockImplementation((name: string) =>
    name === 'my_research_work'
      ? {
          participating: [],
          organized: [
            {
              id: 'test',
              title: '앱 사용성 조사',
              capacity: 2,
              slots_left: 0,
              reward: 1,
              reserved_remaining: 2,
              status: 'open',
              participants: [
                {
                  id: 'submitted-entry',
                  nickname: '참여자 하나',
                  feedback: '테스트 설명이 이해하기 쉬웠습니다.',
                  status: 'submitted',
                },
                { id: 'applied-entry', nickname: '참여자 둘', feedback: null, status: 'applied' },
              ],
            },
          ],
        }
      : null,
  )
  open('/research/mine')

  expect(await screen.findByText('테스트 설명이 이해하기 쉬웠습니다.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '모집 종료' })).not.toBeInTheDocument()
  const pay = screen.getByRole('button', { name: '1 크레딧 지급' })
  expect(mocks.rpc).not.toHaveBeenCalledWith('confirm_research_participation', expect.anything())
  fireEvent.click(pay)
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_research_participation', {
      p_participation_id: 'submitted-entry',
    }),
  )
})
