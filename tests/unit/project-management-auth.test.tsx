import { createClient, type AuthChangeEvent, type Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { expect, it, vi } from 'vitest'
import { AppRoutes } from '../../src/app/App'
import { AuthProvider } from '../../src/features/auth/auth-provider'
import {
  emptyFilters,
  matchingKey,
  type Opportunity,
} from '../../src/features/matching/matching-api'
import {
  myProjectsKey,
  projectKey,
  type ProjectSummary,
} from '../../src/features/projects/project-api'
import type { Database } from '../../src/lib/supabase/database.types'

const getSupabase = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/supabase/client', () => ({ getSupabase, isSupabaseConfigured: true }))

const ownerId = '00000000-0000-4000-8100-000000000201'
const otherId = '00000000-0000-4000-8100-000000000202'
const projectId = '00000000-0000-4000-8100-000000000101'
const schoolId = '00000000-0000-4000-8100-000000000301'
const owner = { user: { id: ownerId }, access_token: 'test-owner-access' } as Session
const renewed = { ...owner, access_token: 'test-renewed-owner-access' }
const other = { user: { id: otherId }, access_token: 'test-other-access' } as Session
const seedProject: ProjectSummary = {
  id: projectId,
  title: '캠퍼스 접근성 지도',
  description: '기록을 보존할 프로젝트입니다.',
  status: 'active',
  visibility: 'private',
  category: 'side_project',
  start_date: null,
  due_date: null,
  created_at: '2026-11-23T00:00:00Z',
}

const recruitment: Opportunity = {
  id: '00000000-0000-4000-8100-000000000401',
  type: 'idea',
  title: '접근성 지도 팀 모집',
  description: '접근성 캠퍼스 데모를 함께 만들어요.',
  roles: ['개발'],
  skills: [],
  university_name: null,
  major: null,
  gap: null,
  source_project_id: null,
  competition: null,
  format: null,
  deadline: null,
  is_mine: true,
  is_open: true,
  request_status: null,
  project_id: projectId,
}

function RouteProbe() {
  return (
    <output data-testid="current-path" hidden>
      {useLocation().pathname}
    </output>
  )
}

function show({ failReadback = false, failList = false } = {}) {
  let session: Session | null = owner
  let project: ProjectSummary | null = seedProject
  const verification = Promise.withResolvers<Response>()
  const write = Promise.withResolvers<Response>()
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const authorization = new Headers(init?.headers).get('Authorization')
    const mine = [owner.access_token, renewed.access_token].some(
      (token) => authorization === `Bearer ${token}`,
    )
    switch (url.pathname) {
      case '/rest/v1/rpc/my_university_verification':
        return authorization === `Bearer ${renewed.access_token}`
          ? verification.promise
          : Response.json(schoolId)
      case '/rest/v1/projects':
        if (failReadback && authorization === `Bearer ${renewed.access_token}`)
          return Response.json({ message: 'temporarily unavailable' }, { status: 400 })
        return Response.json(mine && project ? [project] : [])
      case '/rest/v1/project_members':
        if (failList && !url.searchParams.has('project_id'))
          return Response.json({ message: 'list temporarily unavailable' }, { status: 400 })
        return Response.json(
          mine && project ? [{ membership_role: 'owner', projects: project }] : [],
        )
      case '/rest/v1/universities':
        return Response.json([])
      case '/rest/v1/rpc/list_matching_opportunities':
        return Response.json([{ ...recruitment, is_open: project?.status === 'active' }])
      case '/rest/v1/rpc/complete_project':
      case '/rest/v1/rpc/delete_project':
        return write.promise
      default:
        throw new Error(`Unexpected request: ${url.pathname}`)
    }
  })
  const client = createClient<Database>('https://campus.invalid', 'sb_publishable_test', {
    global: { fetch },
    auth: {
      storageKey: `project-management-auth-test-${crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const listeners = new Set<Parameters<typeof client.auth.onAuthStateChange>[0]>()
  vi.spyOn(client.auth, 'onAuthStateChange').mockImplementation((callback) => {
    listeners.add(callback)
    callback('INITIAL_SESSION', session)
    return {
      data: {
        subscription: {
          id: 'mock-auth-events',
          callback,
          unsubscribe: () => listeners.delete(callback),
        },
      },
    }
  })
  vi.spyOn(client.auth, 'getSession').mockImplementation(async () =>
    session ? { data: { session }, error: null } : { data: { session: null }, error: null },
  )
  getSupabase.mockReturnValue(client)
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
  })
  cache.setQueryData(myProjectsKey(ownerId), [{ ...seedProject, membership_role: 'owner' }])
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={cache}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
          <RouteProbe />
          <Suspense fallback={null}>
            <AppRoutes />
          </Suspense>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
  return {
    cache,
    user,
    fetch,
    count: (path: string) =>
      fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === `/rest/v1/${path}`)
        .length,
    auth: async (event: AuthChangeEvent, next: Session | null) => {
      session = next
      await act(async () => {
        for (const listener of [...listeners]) await listener(event, next)
      })
    },
    verify: () => act(async () => verification.resolve(Response.json(schoolId))),
    changeProject: (next: ProjectSummary | null) => {
      project = next
    },
    settle: (next: ProjectSummary | null, response: Response) =>
      act(async () => {
        project = next
        write.resolve(response)
      }),
  }
}

it('같은 계정이 토큰을 갱신하면 전송한 완료가 끝난 뒤 서버 상세와 목록만 다시 읽는다', async () => {
  const { auth, cache, count, fetch, settle, user, verify } = show()
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }, { timeout: 3000 }))
  await user.click(screen.getByRole('button', { name: '마무리하기' }))
  await user.click(screen.getByRole('button', { name: '완료로 변경' }))
  await waitFor(() => expect(count('rpc/complete_project')).toBe(1))
  await auth('TOKEN_REFRESHED', renewed)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '프로젝트 관리' })).not.toBeInTheDocument()
  await act(async () => {
    await cache.invalidateQueries({ queryKey: projectKey(ownerId, projectId), refetchType: 'none' })
  })
  await verify()
  expect(await screen.findByRole('heading', { name: seedProject.title })).toBeInTheDocument()
  expect(count('projects')).toBe(1)
  const serverProject = {
    ...seedProject,
    title: '서버에서 갱신한 제목',
    status: 'completed',
  } as const
  await settle(serverProject, Response.json(projectId))
  expect(await screen.findByRole('heading', { name: serverProject.title })).toBeInTheDocument()
  expect(screen.getByText('완료', { exact: true })).toBeInTheDocument()
  await waitFor(() =>
    expect(cache.getQueryData(myProjectsKey(ownerId))).toEqual([
      { ...serverProject, membership_role: 'owner' },
    ]),
  )
  expect(screen.queryByText('프로젝트를 마무리했어요.')).not.toBeInTheDocument()
  expect(count('rpc/complete_project')).toBe(1)
  const writeRequest = fetch.mock.calls.find(([input]) =>
    String(input).endsWith('/complete_project'),
  )
  expect(writeRequest?.[1]?.signal?.aborted).toBe(false)
})

it('재검증 중 상세를 떠나도 응답이 불명확한 삭제를 검증 뒤 다시 읽는다', async () => {
  const { auth, cache, count, fetch, settle, user, verify } = show()
  const detailReads = () =>
    fetch.mock.calls.filter(([input]) => new URL(String(input)).searchParams.has('id'))
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }, { timeout: 3000 }))
  await user.click(screen.getByRole('button', { name: '삭제 확인으로' }))
  const dialog = within(screen.getByRole('alertdialog', { name: '프로젝트를 삭제할까요?' }))
  await user.click(dialog.getByRole('checkbox'))
  await user.click(dialog.getByRole('button', { name: '프로젝트 삭제' }))
  await waitFor(() => expect(count('rpc/delete_project')).toBe(1))
  await auth('TOKEN_REFRESHED', renewed)
  await user.click(screen.getByRole('link', { name: / 홈$/ }))
  await settle(null, Response.json({ message: 'connection lost' }, { status: 502 }))
  expect(detailReads()).toHaveLength(1)
  await verify()
  await waitFor(() => expect(cache.getQueryData(myProjectsKey(ownerId))).toEqual([]))
  expect(detailReads()).toHaveLength(2)
  expect(count('rpc/delete_project')).toBe(1)
  expect(screen.queryByText('프로젝트를 삭제했습니다.')).not.toBeInTheDocument()
  expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/$/)
  const reads = fetch.mock.calls.filter(([input]) => {
    const url = new URL(String(input))
    return (
      (url.pathname === '/rest/v1/projects' && url.searchParams.has('id')) ||
      (url.pathname === '/rest/v1/project_members' && !url.searchParams.has('project_id'))
    )
  })
  expect(
    reads.slice(-2).map(([, init]) => new Headers(init?.headers).get('Authorization')),
  ).toEqual([`Bearer ${renewed.access_token}`, `Bearer ${renewed.access_token}`])
})

it.each([
  ['상세 재조회 성공', false],
  ['상세 재조회 실패', true],
] as const)('%s: 모집 화면에서 연결 모집의 마감을 반영한다', async (_label, failReadback) => {
  const { auth, cache, count, settle, user, verify } = show({ failReadback })
  cache.setQueryData(
    [...matchingKey(ownerId), 'board', false, null, emptyFilters, 0],
    [recruitment],
  )
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }, { timeout: 3000 }))
  await user.click(screen.getByRole('button', { name: '마무리하기' }))
  await user.click(screen.getByRole('button', { name: '완료로 변경' }))
  await waitFor(() => expect(count('rpc/complete_project')).toBe(1))
  await auth('TOKEN_REFRESHED', renewed)
  await user.click(screen.getByRole('link', { name: '협업 모집' }))
  await verify()
  expect(await screen.findByRole('button', { name: '모집 마감' })).toBeInTheDocument()
  await settle({ ...seedProject, status: 'completed' }, Response.json(projectId))
  expect(await screen.findByText('지원 마감')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '모집 마감' })).not.toBeInTheDocument()
  expect(count('rpc/list_matching_opportunities')).toBe(1)
})

it.each([
  ['다른 계정 로그인', 'SIGNED_IN', other],
  ['로그아웃', 'SIGNED_OUT', null],
] as const)('%s 뒤에는 이전 계정의 삭제 응답을 반영하지 않는다', async (_label, event, next) => {
  const { auth, cache, count, fetch, settle, user } = show()
  const otherProjects = [{ ...seedProject, title: '다른 계정 프로젝트' }]
  cache.setQueryData(myProjectsKey(otherId), otherProjects)
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }, { timeout: 3000 }))
  await user.click(screen.getByRole('button', { name: '삭제 확인으로' }))
  const dialog = within(screen.getByRole('alertdialog', { name: '프로젝트를 삭제할까요?' }))
  await user.click(dialog.getByRole('checkbox'))
  await user.click(dialog.getByRole('button', { name: '프로젝트 삭제' }))
  await waitFor(() => expect(count('rpc/delete_project')).toBe(1))
  await auth(event, next)
  await settle(null, Response.json(projectId))
  await screen.findByText('프로젝트가 없거나 볼 수 있는 권한이 없습니다.')
  expect(
    fetch.mock.calls.find(([input]) => String(input).endsWith('/delete_project'))?.[1]?.signal
      ?.aborted,
  ).toBe(true)
  expect(cache.getQueryData(projectKey(ownerId, projectId))).toBeUndefined()
  expect(cache.getQueryData(myProjectsKey(ownerId))).toBeUndefined()
  expect(cache.getQueryData(myProjectsKey(otherId))).toEqual(otherProjects)
  expect(screen.queryByText('프로젝트를 삭제했습니다.')).not.toBeInTheDocument()
  expect(count('rpc/delete_project')).toBe(1)
})

async function startCompletion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
  await user.click(screen.getByRole('button', { name: '마무리하기' }))
  await user.click(screen.getByRole('button', { name: '완료로 변경' }))
}

it('목록 재조회가 실패해도 상세의 완료와 연결 모집 갱신을 반영한다', async () => {
  const { user, cache, count, settle } = show({ failList: true })
  const board = [...matchingKey(ownerId), 'board', false, null, emptyFilters, 0]
  cache.setQueryData(board, [recruitment])
  await startCompletion(user)
  await settle({ ...seedProject, status: 'completed' }, Response.json({}, { status: 502 }))
  await waitFor(() =>
    expect(cache.getQueryData(projectKey(ownerId, projectId))).toMatchObject({
      status: 'completed',
    }),
  )
  expect(cache.getQueryData(board)).toBeUndefined()
  expect(count('rpc/complete_project')).toBe(1)
})

it('첫 조회가 서버 커밋보다 빠르면 쓰기를 재전송하지 않고 다시 확인한다', async () => {
  const { user, cache, count, settle, changeProject } = show()
  const board = [...matchingKey(ownerId), 'board', false, null, emptyFilters, 0]
  cache.setQueryData(board, [recruitment])
  await startCompletion(user)
  await settle(seedProject, Response.json({}, { status: 502 }))
  await waitFor(() => expect(count('projects')).toBe(2))
  await waitFor(() => expect(cache.getQueryData(board)).toBeUndefined())
  cache.setQueryData(board, [recruitment])
  changeProject({ ...seedProject, status: 'completed' })
  await waitFor(
    () =>
      expect(cache.getQueryData(projectKey(ownerId, projectId))).toMatchObject({
        status: 'completed',
      }),
    { timeout: 3000 },
  )
  expect(count('projects')).toBeGreaterThan(2)
  expect(cache.getQueryData(board)).toBeUndefined()
  expect(count('rpc/complete_project')).toBe(1)
  expect(screen.queryByText('프로젝트를 마무리했어요.')).not.toBeInTheDocument()
})

it('자동 확인으로도 미확정이면 쓰기를 잠그고 사용자가 읽기만 다시 시도할 수 있다', async () => {
  const { user, cache, count, fetch, settle, changeProject } = show()
  await startCompletion(user)
  await settle(seedProject, Response.json({}, { status: 502 }))
  const recheck = await screen.findByRole('button', { name: '결과 다시 확인' }, { timeout: 4000 })
  expect(screen.getByRole('button', { name: '완료로 변경' })).toBeDisabled()
  expect(
    fetch.mock.calls.filter(
      ([input, init]) => new URL(String(input)).pathname === '/rest/v1/projects' && init?.signal,
    ),
  ).toHaveLength(3)
  changeProject({ ...seedProject, status: 'completed' })
  await user.click(recheck)
  await waitFor(() =>
    expect(cache.getQueryData(projectKey(ownerId, projectId))).toMatchObject({
      status: 'completed',
    }),
  )
  expect(count('rpc/complete_project')).toBe(1)
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '결과 다시 확인' })).not.toBeInTheDocument(),
  )
})
