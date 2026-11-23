import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { RequireAuth } from '../../src/app/router/guards'
import { AuthCallbackPage, AuthPage } from '../../src/features/auth/AuthPage'
import { AuthProvider } from '../../src/features/auth/auth-provider'
import { rememberAuthReturnPath } from '../../src/features/auth/return-path'
import { InvitePage } from '../../src/features/projects/InvitePage'
import { ProfileSettingsPage } from '../../src/features/profiles/ProfileSettingsPage'

const auth = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))
const rpc = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({ auth, rpc, from }),
}))

const invitePath = `/invite#${'a'.repeat(64)}`

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  auth.onAuthStateChange.mockImplementation((notify) => {
    notify('INITIAL_SESSION', null)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
})

function renderWithAuth(children: ReactNode, entry: string | { pathname: string; state: unknown }) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

it('학교 Google 로그인만 시작하고 초대 토큰을 OAuth 주소에 넘기지 않는다', async () => {
  auth.signInWithOAuth.mockResolvedValue({ error: null })
  renderWithAuth(<AuthPage mode="login" />, { pathname: '/login', state: { next: invitePath } })

  expect(screen.queryByLabelText('이메일 주소')).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: '학교 Google 계정으로 계속하기' }))

  expect(auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { prompt: 'select_account' },
    },
  })
  expect(Object.values(sessionStorage)).toContain(invitePath)
})

it('DB가 학교 인증을 거부한 기존 세션은 초대 수락에 접근하지 못한다', async () => {
  auth.onAuthStateChange.mockImplementation((notify) => {
    notify('INITIAL_SESSION', { user: { id: 'legacy-user' } })
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  rpc.mockResolvedValue({ data: null, error: null })
  renderWithAuth(<InvitePage />, invitePath)

  expect(await screen.findByRole('alert')).toHaveTextContent('등록된 학교의 Google Workspace 계정')
  expect(rpc).toHaveBeenCalledWith('my_university_verification')
  expect(screen.queryByRole('button', { name: '프로젝트 참여' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '학교 Google 계정으로 로그인' })).toBeInTheDocument()
})

function ArrivalPage() {
  const { pathname, hash } = useLocation()
  return <h1>{`${pathname}${hash}`}</h1>
}

function renderCallback(url: string) {
  return renderWithAuth(
    <StrictMode>
      <Routes>
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route path="invite" element={<ArrivalPage />} />
        <Route path="dashboard" element={<ArrivalPage />} />
        <Route path="login" element={<AuthPage mode="login" />} />
      </Routes>
    </StrictMode>,
    url,
  )
}

it('PKCE 교환과 DB 학교 인증이 완료되면 원래 초대 프래그먼트로 돌아온다', async () => {
  const session = { user: { id: 'school-user' } }
  auth.exchangeCodeForSession.mockImplementation(async () => {
    await Promise.resolve()
    auth.onAuthStateChange.mock.calls[0][0]('SIGNED_IN', session)
    return { data: { session }, error: null }
  })
  rpc.mockResolvedValue({ data: 'verified-school', error: null })
  rememberAuthReturnPath(invitePath)
  renderCallback('/auth/callback?code=test-returned-code')

  expect(await screen.findByRole('heading', { name: invitePath })).toBeInTheDocument()
  expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('test-returned-code')
  expect(rpc).toHaveBeenCalledWith('my_university_verification')
  expect(Object.values(sessionStorage)).not.toContain(invitePath)
})

it('학교 인증 조회 오류가 나면 보호 화면을 숨기고 같은 화면에서 다시 조회한다', async () => {
  auth.onAuthStateChange.mockImplementation((notify) => {
    notify('INITIAL_SESSION', { user: { id: 'school-user' } })
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  rpc.mockResolvedValueOnce({ error: new Error('offline') })
  rpc.mockResolvedValueOnce({ data: 'verified-school', error: null })
  renderWithAuth(
    <Routes>
      <Route path="login" element={<AuthPage mode="login" />} />
      <Route element={<RequireAuth />}>
        <Route path="settings" element={<ArrivalPage />} />
      </Route>
    </Routes>,
    '/settings',
  )

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '학교 인증 상태를 불러오지 못했습니다.',
  )
  expect(screen.queryByRole('heading', { name: '로그인' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '/settings' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('heading', { name: '/settings' })).toBeInTheDocument()
})

it('동일한 인증 세션 알림을 다시 받아도 보호 화면을 초기화하지 않는다', async () => {
  const session = { user: { id: 'school-user' } }
  auth.onAuthStateChange.mockImplementation((notify) => {
    notify('INITIAL_SESSION', session)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  rpc.mockResolvedValue({ data: 'verified-school', error: null })
  renderWithAuth(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="settings" element={<ArrivalPage />} />
      </Route>
    </Routes>,
    '/settings',
  )

  expect(await screen.findByRole('heading', { name: '/settings' })).toBeInTheDocument()
  act(() => auth.onAuthStateChange.mock.calls[0][0]('SIGNED_IN', { ...session }))
  expect(screen.getByRole('heading', { name: '/settings' })).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledTimes(1)
})

it('콜백에서 명시적인 거부를 받으면 코드를 교환하지 않고 초대 주소를 유지해 재시도한다', async () => {
  rememberAuthReturnPath(invitePath)
  auth.signInWithOAuth.mockResolvedValue({ error: null })
  renderCallback(
    '/auth/callback?code=ignored&error=access_denied&error_description=upstream-detail',
  )

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Google 로그인이 취소되었거나 거부되었습니다.',
  )
  expect(screen.queryByText('upstream-detail')).not.toBeInTheDocument()
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('link', { name: '로그인 다시 시작' }))
  fireEvent.click(await screen.findByRole('button', { name: '학교 Google 계정으로 계속하기' }))
  expect(Object.values(sessionStorage)).toContain(invitePath)
})

it('PKCE 교환이 실패하면 확인 화면에서 멈추고 로그인 재시도를 안내한다', async () => {
  auth.exchangeCodeForSession.mockResolvedValue({ error: new Error('expired') })
  rememberAuthReturnPath(invitePath)
  renderCallback('/auth/callback?code=test-expired-code')

  expect(await screen.findByRole('alert')).toHaveTextContent('Google 로그인을 완료하지 못했습니다.')
  expect(screen.getByRole('link', { name: '로그인 다시 시작' })).toHaveAttribute('href', '/login')
  expect(screen.queryByRole('heading', { name: invitePath })).not.toBeInTheDocument()
})

it('프로필 학교는 기존 프로필 값 대신 DB 인증값을 읽기 전용으로 보여준다', async () => {
  const verifiedSchool = { id: '2c11d87a-358b-4f45-934f-a88d95574a41', name: '인증 대학' }
  const oldSchool = { id: '6d3d8dba-bc88-444d-b0f0-e6179ec2127e', name: '기존 대학' }
  auth.onAuthStateChange.mockImplementation((notify) => {
    notify('INITIAL_SESSION', { user: { id: 'school-user' } })
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  rpc.mockResolvedValue({ data: verifiedSchool.id, error: null })
  const oldProfile = {
    nickname: '이전 닉네임',
    university_id: oldSchool.id,
    major: '컴퓨터공학',
    bio: '함께 만들고 싶습니다.',
    skills: ['React'],
    interests: ['접근성'],
    preferred_category: 'side_project',
    visibility: 'private',
  }
  const update = vi.fn(() => ({
    eq: () => ({
      select: () => ({
        single: async () => ({ data: { ...oldProfile, university_id: verifiedSchool.id } }),
      }),
    }),
  }))
  from.mockImplementation((table: string) =>
    table === 'universities'
      ? {
          select: () => ({
            eq: () => ({ order: async () => ({ data: [oldSchool, verifiedSchool] }) }),
          }),
        }
      : {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: oldProfile }) }) }),
          update,
        },
  )
  renderWithAuth(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="settings" element={<ProfileSettingsPage />} />
      </Route>
    </Routes>,
    '/settings',
  )

  const school = await screen.findByRole('textbox', { name: '소속 학교' })
  expect(school).toHaveAttribute('readonly')
  expect(school).toHaveValue(verifiedSchool.name)
  fireEvent.click(screen.getByRole('button', { name: '프로필 저장' }))
  expect(await screen.findByText('프로필을 저장했습니다.')).toBeInTheDocument()
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ university_id: verifiedSchool.id }))
})

it('잘못된 초대 주소를 받으면 참여 버튼 대신 안내를 표시한다', () => {
  render(
    <MemoryRouter initialEntries={['/invite#not-an-invitation']}>
      <InvitePage />
    </MemoryRouter>,
  )
  expect(screen.getByRole('alert')).toHaveTextContent('초대 주소가 올바르지 않습니다.')
  expect(screen.queryByRole('button', { name: '프로젝트 참여' })).not.toBeInTheDocument()
})
