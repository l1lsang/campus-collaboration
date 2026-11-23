import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Suspense } from 'react'
import { Link, MemoryRouter } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../src/app/App'
import { AuthProvider } from '../../src/features/auth/auth-provider'

const { rpc, onAuthStateChange, profile, attachHeader, attachSignal } = vi.hoisted(() => ({
  rpc: vi.fn(),
  onAuthStateChange: vi.fn(),
  profile: vi.fn(),
  attachHeader: vi.fn(),
  attachSignal: vi.fn(),
}))
vi.mock('../../src/lib/supabase/client', () => ({
  isSupabaseConfigured: true,
  getSupabase: () => ({
    auth: { onAuthStateChange },
    rpc: (...args: unknown[]) => {
      const request = Promise.resolve(rpc(...args))
      return Object.assign(request, {
        setHeader: (name: string, value: string) => {
          attachHeader(name, value)
          return request
        },
        abortSignal: (signal: AbortSignal) => {
          attachSignal(signal)
          return request
        },
      })
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: profile }) }) }),
  }),
}))

const projectId = '00000000-0000-4000-8100-000000000101'
const ownerId = '00000000-0000-4000-8100-000000000201'
const reportsPath = `/projects/${projectId}/reports`
const school = { data: 'school-1', error: null }
const reportWorkspace = {
  title: '내부 프로젝트',
  isOwner: true,
  latestRevision: null,
  publication: null,
}
const response = (data: unknown) => ({ data, error: null })
const session = (token: string, userId = ownerId) =>
  ({ access_token: token, user: { id: userId } }) as Session
let notify: (event: AuthChangeEvent, next: Session | null) => void
let verify: () => unknown
let workspace: () => unknown

beforeEach(() => {
  verify = () => school
  workspace = () => response(reportWorkspace)
  attachHeader.mockClear()
  attachSignal.mockClear()
  profile.mockReset().mockResolvedValue(response({ id: ownerId }))
  onAuthStateChange.mockReset().mockImplementation((callback) => {
    notify = callback
    notify('INITIAL_SESSION', session('initial'))
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'my_university_verification') return verify()
    if (name === 'get_project_report_workspace') return workspace()
    if (name === 'list_project_report_revisions') return response([])
    throw new Error(name)
  })
})

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
  })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[reportsPath]}>
          <Link to={reportsPath}>보고서 다시 열기</Link>
          <Suspense fallback={null}>
            <AppRoutes />
          </Suspense>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return client
}

it('실제 라우트에서 동일 계정 토큰을 재검증하는 동안 보고서를 잠그고 문안을 복원한다', async () => {
  show()
  await screen.findByLabelText('보고서 제목')
  fireEvent.change(screen.getByLabelText('보고서 유형'), { target: { value: 'handoff' } })
  fireEvent.change(await screen.findByLabelText('보고서 제목'), {
    target: { value: '미저장 제목' },
  })
  fireEvent.click(screen.getByRole('button', { name: '섹션 추가' }))
  const section = screen.getByRole('group', { name: '섹션 1' })
  fireEvent.change(within(section).getByLabelText('제목'), { target: { value: '미저장 섹션' } })
  fireEvent.change(within(section).getByLabelText('본문'), { target: { value: '미저장 본문' } })
  const saves = () => rpc.mock.calls.filter(([name]) => name === 'save_project_report_layout')
  const form = screen.getByRole('button', { name: '새 판 저장' }).closest('form')!

  const checkingSchool = Promise.withResolvers<typeof school>()
  verify = () => checkingSchool.promise
  await act(async () => {
    notify('TOKEN_REFRESHED', session('refreshed'))
    // The auth event can precede React's commit that removes the form.
    fireEvent.submit(form)
  })
  expect(await screen.findByText('로그인 상태 확인 중…')).toBeInTheDocument()
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '새 판 저장' })).not.toBeInTheDocument()
  fireEvent.submit(form)
  expect(saves()).toHaveLength(0)

  await act(async () => checkingSchool.resolve(school))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('미저장 제목')
  expect(screen.getByLabelText('보고서 유형')).toHaveValue('handoff')
  expect(screen.getByLabelText('제목', { exact: true })).toHaveValue('미저장 섹션')
  expect(screen.getByLabelText('본문')).toHaveValue('미저장 본문')
  expect(screen.getByText('저장되지 않은 변경이 있습니다.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '새 판 저장' })).toBeEnabled()
})

it('새 토큰으로 작업공간 접근이 확인될 때까지 이전 요청 결과를 사용하지 않는다', async () => {
  const client = show()
  const title = await screen.findByLabelText('보고서 제목')
  fireEvent.change(title, { target: { value: '이전 권한에서 작성한 미저장 제목' } })
  expect(screen.getByText('저장되지 않은 변경이 있습니다.')).toBeInTheDocument()

  const oldWorkspace = Promise.withResolvers<ReturnType<typeof response>>()
  workspace = () => oldWorkspace.promise
  const workspaces = () =>
    rpc.mock.calls.filter(([name]) => name === 'get_project_report_workspace')
  act(() => void client.invalidateQueries({ queryKey: ['account', ownerId, 'reports'] }))
  await waitFor(() => expect(workspaces()).toHaveLength(2))

  const checkingSchool = Promise.withResolvers<typeof school>()
  const newWorkspace = Promise.withResolvers<ReturnType<typeof response>>()
  verify = () => checkingSchool.promise
  workspace = () => newWorkspace.promise
  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(await screen.findByText('로그인 상태 확인 중…')).toBeInTheDocument()
  await act(async () => checkingSchool.resolve(school))
  await waitFor(() => expect(workspaces()).toHaveLength(3))
  await act(async () => oldWorkspace.resolve(response(reportWorkspace)))
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '새 판 저장' })).not.toBeInTheDocument()

  await act(async () => newWorkspace.resolve(response({ ...reportWorkspace, isOwner: false })))
  expect(await screen.findByText(/저장된 보고서를 볼 수 있습니다/)).toBeInTheDocument()
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()

  workspace = () => response(reportWorkspace)
  await act(async () => client.invalidateQueries({ queryKey: ['account', ownerId, 'reports'] }))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

async function editTitle() {
  fireEvent.change(await screen.findByLabelText('보고서 제목'), {
    target: { value: '계정 A 초안' },
  })
}

it('학교 재검증 실패 뒤 같은 계정으로 다시 시도해도 초안은 되살아나지 않는다', async () => {
  show()
  await editTitle()
  verify = () => ({ data: null, error: new Error('unavailable') })
  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '학교 인증 상태를 불러오지 못했습니다.',
  )
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()

  verify = () => school
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

it('학교 재검증 거절 뒤 보고서에 다시 접근해도 초안은 되살아나지 않는다', async () => {
  show()
  await editTitle()
  verify = () => response(null)
  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '등록된 학교의 Google 계정으로 다시 로그인해 주세요.',
  )
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()

  verify = () => school
  act(() => notify('SIGNED_IN', session('signed-in-again')))
  await screen.findByRole('button', { name: '로그아웃' })
  fireEvent.click(screen.getByRole('link', { name: '보고서 다시 열기' }))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

it('다른 계정으로 전환할 때 이전 계정의 늦은 인증과 초안은 복원되지 않는다', async () => {
  show()
  await editTitle()
  const checkingOwner = Promise.withResolvers<typeof school>()
  verify = () => checkingOwner.promise
  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(await screen.findByText('로그인 상태 확인 중…')).toBeInTheDocument()

  verify = () => school
  workspace = () => response({ ...reportWorkspace, title: '계정 B 프로젝트' })
  act(() => notify('SIGNED_IN', session('account-b', '00000000-0000-4000-8100-000000000202')))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('계정 B 프로젝트 · 활동 보고서')
  await act(async () => checkingOwner.resolve(school))
  expect(screen.getByLabelText('보고서 제목')).toHaveValue('계정 B 프로젝트 · 활동 보고서')

  workspace = () => response(reportWorkspace)
  act(() => notify('SIGNED_IN', session('refreshed')))
  await waitFor(() =>
    expect(screen.getByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서'),
  )
})

it('같은 렌더에 로그아웃과 재로그인이 모두 도착해도 초안을 비운다', async () => {
  show()
  await editTitle()
  act(() => {
    notify('SIGNED_OUT', null)
    notify('SIGNED_IN', session('initial'))
  })
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

it('같은 계정이라도 새 로그인으로 세션을 교체하면 초안을 비운다', async () => {
  show()
  await editTitle()
  act(() => notify('SIGNED_IN', session('new-login')))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

it('프로필 검증 실패 후 재시도해도 잠겨 있던 초안은 복원하지 않는다', async () => {
  const client = show()
  await editTitle()
  const checkingSchool = Promise.withResolvers<typeof school>()
  verify = () => checkingSchool.promise
  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(await screen.findByText('로그인 상태 확인 중…')).toBeInTheDocument()

  const checkingProfile = Promise.withResolvers<{ data: null; error: Error }>()
  profile.mockReturnValue(checkingProfile.promise)
  await act(async () => client.invalidateQueries({ queryKey: ['account', ownerId, 'profile'] }))
  await act(async () => checkingSchool.resolve(school))
  expect(await screen.findByText('프로필 확인 중…')).toBeInTheDocument()
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()
  await act(async () => checkingProfile.resolve({ data: null, error: new Error('unavailable') }))
  expect(await screen.findByRole('alert')).toHaveTextContent('프로필을 불러오지 못했습니다.')
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()

  profile.mockResolvedValue(response({ id: ownerId }))
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

it('새 토큰의 작업공간 검증에 실패하면 재조회에 성공해도 초안을 복원하지 않는다', async () => {
  show()
  await editTitle()
  workspace = () => ({ data: null, error: new Error('unavailable') })
  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '보고서 작업공간을 불러오지 못했습니다.',
  )
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()

  workspace = () => response(reportWorkspace)
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('내부 프로젝트 · 활동 보고서')
})

it('토큰 갱신 전에 시작된 저장의 늦은 응답은 새 세션으로 재조회하지 않는다', async () => {
  const saving = Promise.withResolvers<ReturnType<typeof response>>()
  const handleRpc = rpc.getMockImplementation()!
  rpc.mockImplementation((name: string, args: unknown) =>
    name === 'save_project_report_layout' ? saving.promise : handleRpc(name, args),
  )
  show()
  await editTitle()
  fireEvent.click(screen.getByRole('button', { name: '새 판 저장' }))
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith('save_project_report_layout', {
      p_project_id: projectId,
      p_kind: 'activity',
      p_expected_number: 0,
      p_layout: { title: '계정 A 초안', source: 'blank', sections: [] },
    }),
  )

  expect(attachHeader).toHaveBeenCalledWith('Authorization', 'Bearer initial')
  const requestSignal = attachSignal.mock.calls[0]?.[0] as AbortSignal
  expect(requestSignal.aborted).toBe(false)

  act(() => notify('TOKEN_REFRESHED', session('refreshed')))
  expect(requestSignal.aborted).toBe(true)
  expect(await screen.findByLabelText('보고서 제목')).toHaveValue('계정 A 초안')
  await act(async () => saving.resolve(response({ id: 'revision-1', number: 1 })))
  expect(rpc.mock.calls.some(([name]) => name === 'get_project_report_revision')).toBe(false)
  expect(screen.getByLabelText('보고서 제목')).toHaveValue('계정 A 초안')
  expect(screen.queryByText('1판을 저장했습니다.')).not.toBeInTheDocument()
})
