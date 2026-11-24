import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { DashboardPage } from '../../src/features/dashboard/DashboardPage'
import { matchingKey } from '../../src/features/matching/matching-api'
import { ProjectPage } from '../../src/features/projects/ProjectPage'
import {
  myProjectsKey,
  projectKey,
  publicProjectsKey,
  type ProjectSummary,
} from '../../src/features/projects/project-api'
import type { Database } from '../../src/lib/supabase/database.types'

const { getSupabase, useAuth } = vi.hoisted(() => ({ getSupabase: vi.fn(), useAuth: vi.fn() }))
vi.mock('../../src/lib/supabase/client', () => ({ getSupabase, isSupabaseConfigured: true }))
vi.mock('../../src/features/auth/auth-provider', () => ({ useAuth }))
vi.mock('../../src/features/profiles/profile-api', () => ({ useMyProfile: () => ({}) }))
vi.mock('../../src/features/universities/SchoolVerification', () => ({
  SchoolVerification: () => null,
}))

const ownerId = '00000000-0000-4000-8100-000000000201'
const projectId = '00000000-0000-4000-8100-000000000101'
const session = { user: { id: ownerId }, access_token: 'mock-owner-access' } as Session
const otherSession = {
  ...session,
  user: { ...session.user, id: 'other-account' },
  access_token: 'mock-other-access',
}
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
let project: ProjectSummary
let role: 'owner' | 'member' | null
let deleted: boolean
let deleteResponse: () => Promise<Response>
let dashboardProjects: { membership_role: 'owner' | 'member'; projects: ProjectSummary }[]
let client: SupabaseClient<Database>

const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input)).pathname
  switch (path) {
    case '/rest/v1/projects':
      return Response.json(deleted ? [] : [project])
    case '/rest/v1/project_members': {
      const query = new URL(String(input)).searchParams
      const own = role && !deleted ? [{ membership_role: role, projects: project }] : []
      return Response.json(query.has('project_id') ? own : [...own, ...dashboardProjects])
    }
    case '/rest/v1/rpc/complete_project':
      project = { ...project, status: 'completed' }
      return Response.json(projectId)
    case '/rest/v1/rpc/delete_project':
      return deleteResponse()
    default:
      throw new Error(`Unexpected request: ${path} ${init?.method}`)
  }
})

beforeEach(() => {
  project = { ...seedProject }
  role = 'owner'
  deleted = false
  dashboardProjects = []
  deleteResponse = async () => {
    deleted = true
    return Response.json(projectId)
  }
  fetch.mockClear()
  client = createClient<Database>('https://campus.invalid', 'sb_publishable_test', {
    global: { fetch },
    auth: {
      storageKey: `project-management-test-${crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session }, error: null })
  getSupabase.mockReturnValue(client)
  useAuth.mockReturnValue({ loading: false, session })
})

function show(path = `/projects/${projectId}`) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, cache, user: userEvent.setup() }
}

it('팀장은 완료를 확인한 뒤 기록 접근과 공개 범위를 유지한 채 프로젝트를 마무리한다', async () => {
  const { user } = show()
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
  await user.click(screen.getByRole('button', { name: '마무리하기' }))
  const dialog = screen.getByRole('alertdialog', { name: '프로젝트를 마무리할까요?' })
  expect(dialog).toHaveTextContent('팀원은 팀플로그와 저장된 보고서를 계속 볼 수 있어요.')
  expect(dialog).toHaveTextContent('공개 범위는 바뀌지 않아요')
  expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus()
  expect(fetch.mock.calls.some(([input]) => String(input).includes('/rpc/'))).toBe(false)

  await user.click(within(dialog).getByRole('button', { name: '완료로 변경' }))
  expect(await screen.findByText('프로젝트를 마무리했어요.')).toBeInTheDocument()
  expect(screen.getByText('완료', { exact: true })).toBeInTheDocument()
  expect(screen.getByText('팀원만 보기')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '보고서와 인수인계' })).toBeInTheDocument()
  const [request] = fetch.mock.calls.filter(([input]) => String(input).includes('/rpc/'))
  expect(String(request[0])).toBe('https://campus.invalid/rest/v1/rpc/complete_project')
  expect(request[1]?.body).toBe(JSON.stringify({ p_project_id: projectId }))
  expect(new Headers(request[1]?.headers).get('Authorization')).toBe('Bearer mock-owner-access')
})

async function openDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
  await user.click(screen.getByRole('button', { name: '삭제 확인으로' }))
  return within(screen.getByRole('alertdialog', { name: '프로젝트를 삭제할까요?' }))
}

const deleteRequests = () =>
  fetch.mock.calls.filter(([input]) => String(input).endsWith('/rpc/delete_project'))

it.each([
  ['마무리하기', '프로젝트를 마무리할까요?'],
  ['삭제 확인으로', '프로젝트를 삭제할까요?'],
])(
  '%s 확인에서 직접 연결된 모집과 검토 중인 지원에 미치는 영향을 알린다',
  async (button, title) => {
    const { user } = show()
    await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
    await user.click(screen.getByRole('button', { name: button }))
    const dialog = screen.getByRole('alertdialog', { name: title })
    expect(dialog).toHaveTextContent(/직접 연결된 모집글.*마감.*검토 중인 지원.*거절/)
    expect(dialog).toHaveTextContent(/리부트 원본으로만 참조하는 모집글.*모집 상태와 지원은 그대로/)
  },
)

it('삭제 확인은 공개 보고서도 경험 아카이브에서 제거된다고 알린다', async () => {
  const { user } = show()
  const dialog = await openDelete(user)
  expect(dialog.getByText(/공개한 보고서도 경험 아카이브에서 내려갑니다/)).toBeInTheDocument()
})

it('삭제 확인은 기본 해제되어 있고 취소는 요청하지 않으며 다음 확인에 동의를 남기지 않는다', async () => {
  const { user } = show()
  const dialog = await openDelete(user)
  expect(dialog.getByText('삭제는 되돌릴 수 없습니다.')).toBeInTheDocument()
  expect(dialog.getByText(/팀플로그와 보고서에 접근할 수 없게 됩니다/)).toBeInTheDocument()
  const consent = dialog.getByRole('checkbox', { name: '삭제 내용을 확인했습니다.' })
  const remove = dialog.getByRole('button', { name: '프로젝트 삭제' })
  expect(consent).not.toBeChecked()
  expect(remove).toBeDisabled()
  expect(dialog.getByRole('button', { name: '취소' })).toHaveFocus()
  await user.click(consent)
  expect(remove).toBeEnabled()
  await user.click(dialog.getByRole('button', { name: '취소' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '삭제 확인으로' }))
  expect(screen.getByRole('checkbox')).not.toBeChecked()
  expect(deleteRequests()).toHaveLength(0)
})

it('삭제 처리 중에는 취소와 중복 요청이 막히고 확인된 성공만 대시보드에서 제거한다', async () => {
  project = { ...project, visibility: 'public' }
  const otherId = 'other-account'
  const otherProject = { ...project, id: 'other-project' }
  const mine = { ...project, membership_role: 'owner' }
  const { cache, user } = show()
  cache.setQueryData(myProjectsKey(ownerId), [mine])
  cache.setQueryData(myProjectsKey(otherId), [otherProject])
  cache.setQueryData(projectKey(undefined, projectId), project)
  cache.setQueryData(publicProjectsKey, [project, otherProject])
  const response = Promise.withResolvers<Response>()
  deleteResponse = () => response.promise

  const dialog = await openDelete(user)
  await user.click(dialog.getByRole('checkbox'))
  await user.click(dialog.getByRole('button', { name: '프로젝트 삭제' }))
  await waitFor(() => expect(deleteRequests()).toHaveLength(1))
  expect(dialog.getByRole('button', { name: '취소' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(dialog.getByRole('button', { name: '삭제 중…' })).toBeDisabled()
  expect(cache.getQueryData(myProjectsKey(ownerId))).toEqual([mine])
  const [[, request]] = deleteRequests()
  expect(request?.body).toBe(JSON.stringify({ p_project_id: projectId, p_confirm: true }))

  await act(async () => {
    deleted = true
    response.resolve(Response.json(projectId))
  })
  expect(await screen.findByText('프로젝트를 삭제했습니다.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '내 프로젝트' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /캠퍼스 접근성 지도/ })).not.toBeInTheDocument()
  expect(cache.getQueryData(myProjectsKey(otherId))).toEqual([otherProject])
  expect(cache.getQueryData(publicProjectsKey)).toEqual([otherProject])
  expect(cache.getQueryData(projectKey(undefined, projectId))).toBeNull()
  expect(deleteRequests()).toHaveLength(1)
})

it('대시보드는 역할과 무관하게 완료 프로젝트만 별도 목록에 넣는다', async () => {
  dashboardProjects = [
    {
      membership_role: 'member',
      projects: { ...project, id: 'completed-id', title: '마친 팀 프로젝트', status: 'completed' },
    },
    {
      membership_role: 'member',
      projects: { ...project, id: 'paused-id', title: '일시 중단 팀 프로젝트', status: 'paused' },
    },
    {
      membership_role: 'owner',
      projects: { ...project, id: 'archived-id', title: '보관 프로젝트', status: 'archived' },
    },
  ]
  const { user } = show()
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
  await user.click(screen.getByRole('button', { name: '마무리하기' }))
  await user.click(screen.getByRole('button', { name: '완료로 변경' }))
  await screen.findByText('프로젝트를 마무리했어요.')
  await user.click(screen.getByRole('link', { name: '대시보드' }))

  const done = within(await screen.findByRole('region', { name: '완료한 프로젝트' }))
  expect(done.getByRole('heading', { name: '마친 팀 프로젝트' })).toBeInTheDocument()
  expect(done.getByRole('heading', { name: '캠퍼스 접근성 지도' })).toBeInTheDocument()
  expect(done.getAllByRole('listitem')).toHaveLength(2)
  const rest = within(screen.getByRole('region', { name: '내 프로젝트' }))
  expect(rest.getByRole('heading', { name: '일시 중단 팀 프로젝트' })).toBeInTheDocument()
  expect(rest.getByRole('heading', { name: '보관 프로젝트' })).toBeInTheDocument()
  expect(rest.getAllByRole('listitem')).toHaveLength(2)
})

it.each(['member', 'guest'] as const)(
  '%s는 공개 프로젝트를 읽어도 관리 버튼을 볼 수 없다',
  async (viewer) => {
    project = { ...project, visibility: 'public' }
    role = viewer === 'member' ? 'member' : null
    if (viewer === 'guest') useAuth.mockReturnValue({ loading: false, session: null })
    const { cache } = show()
    await screen.findByRole('heading', { name: project.title })
    if (viewer === 'member') await screen.findByRole('link', { name: '보고서와 인수인계' })
    else
      expect(
        cache.getQueryState([...projectKey(undefined, projectId), 'membership'])?.fetchStatus,
      ).toBe('idle')
    expect(screen.queryByRole('button', { name: '프로젝트 관리' })).not.toBeInTheDocument()
  },
)

it.each([
  ['PROJECT_HAS_RESEARCH', /연결된 연구 테스트.*크레딧 기록.*삭제 대신 마무리/],
  ['PROJECT_MANAGEMENT_NOT_ALLOWED', /팀장만 프로젝트를 관리할 수 있어요/],
  ['PROJECT_DELETE_CONFIRMATION_REQUIRED', /삭제 내용을 확인한 뒤/],
])('%s 응답은 삭제 완료 대신 조치 안내를 표시한다', async (message, expected) => {
  deleteResponse = async () => Response.json({ code: 'P0001', message }, { status: 400 })
  const { cache, user } = show()
  const dialog = await openDelete(user)
  await user.click(dialog.getByRole('checkbox'))
  await user.click(dialog.getByRole('button', { name: '프로젝트 삭제' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(expected)
  expect(dialog.getByRole('button', { name: '취소' })).toBeEnabled()
  expect(cache.getQueryData(projectKey(ownerId, projectId))).toEqual(project)
  expect(screen.queryByText('프로젝트를 삭제했습니다.')).not.toBeInTheDocument()
})

it('보관한 프로젝트는 마무리할 수 없음을 안내하고 요청을 막는다', async () => {
  project = { ...project, status: 'archived' }
  const { user } = show()
  await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
  expect(screen.getByRole('button', { name: '마무리하기' })).toBeDisabled()
  expect(screen.getByText('보관한 프로젝트는 마무리할 수 없어요.')).toBeInTheDocument()
  expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/complete_project'))).toBe(
    false,
  )
})

it('완료가 거부된 프로젝트는 완료 상태나 성공 안내로 바뀌지 않는다', async () => {
  const originalFetch = fetch.getMockImplementation()!
  fetch.mockImplementation((input, init) =>
    String(input).endsWith('/rpc/complete_project')
      ? Promise.resolve(
          Response.json({ code: 'P0001', message: 'PROJECT_CANNOT_COMPLETE' }, { status: 400 }),
        )
      : originalFetch(input, init),
  )
  try {
    const { cache, user } = show()
    await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
    await user.click(screen.getByRole('button', { name: '마무리하기' }))
    await user.click(screen.getByRole('button', { name: '완료로 변경' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '현재 상태에서는 이 프로젝트를 마무리할 수 없어요.',
    )
    expect(cache.getQueryData(projectKey(ownerId, projectId))).toEqual(project)
    expect(screen.queryByText('프로젝트를 마무리했어요.')).not.toBeInTheDocument()
  } finally {
    fetch.mockImplementation(originalFetch)
  }
})

it.each([null, ownerId])(
  '서버가 이 프로젝트의 UUID를 반환하지 않으면 삭제를 확인하지 않는다: %s',
  async (result) => {
    deleteResponse = async () => Response.json(result)
    const { cache, user } = show()
    const dialog = await openDelete(user)
    await user.click(dialog.getByRole('checkbox'))
    await user.click(dialog.getByRole('button', { name: '프로젝트 삭제' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent(
      /삭제를 확인하지 못했습니다.*현재 상태를 확인/,
    )
    expect(cache.getQueryData(projectKey(ownerId, projectId))).toEqual(project)
    expect(screen.queryByText('프로젝트를 삭제했습니다.')).not.toBeInTheDocument()
  },
)

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await openDelete(user)
  await user.click(dialog.getByRole('checkbox'))
  return { dialog, submit: () => user.click(dialog.getByRole('button', { name: '프로젝트 삭제' })) }
}

it.each(['complete', 'delete'] as const)(
  '비공개 프로젝트 %s 뒤에는 팀장 모집·지원 캐시만 비운다',
  async (action) => {
    const { cache, user } = show()
    const board = [...matchingKey(ownerId), 'board', true, null, {}, 0]
    const requests = [...matchingKey(ownerId), 'requests', true, 0]
    const sources = [...matchingKey(ownerId), 'sources', '', 0]
    const otherBoard = [...matchingKey(otherSession.user.id), 'board', true, null, {}, 0]
    for (const key of [board, requests, sources, otherBoard]) cache.setQueryData(key, ['기존 값'])

    if (action === 'complete') {
      await user.click(await screen.findByRole('button', { name: '프로젝트 관리' }))
      await user.click(screen.getByRole('button', { name: '마무리하기' }))
      await user.click(screen.getByRole('button', { name: '완료로 변경' }))
      await screen.findByText('프로젝트를 마무리했어요.')
    } else {
      const { submit } = await confirmDelete(user)
      await submit()
      await screen.findByText('프로젝트를 삭제했습니다.')
    }

    expect(cache.getQueryState(board)).toBeUndefined()
    expect(cache.getQueryState(requests)).toBeUndefined()
    expect(cache.getQueryState(sources)?.isInvalidated).toBe(false)
    expect(cache.getQueryData(otherBoard)).toEqual(['기존 값'])
  },
)

it('검증 중 계정이 바뀌면 새 계정의 자격으로 삭제 요청을 보내지 않는다', async () => {
  const { user } = show()
  const { dialog, submit } = await confirmDelete(user)
  const check = Promise.withResolvers<Awaited<ReturnType<typeof client.auth.getSession>>>()
  vi.mocked(client.auth.getSession).mockReturnValueOnce(check.promise)
  await submit()
  await act(async () => check.resolve({ data: { session: otherSession }, error: null }))
  expect(await dialog.findByRole('alert')).toHaveTextContent(/로그인 계정이 바뀌었어요/)
  expect(deleteRequests()).toHaveLength(0)
})

it('같은 계정의 갱신 토큰으로 요청을 고정하고 SDK가 다시 구한 다른 계정 토큰은 보내지 않는다', async () => {
  const { user } = show()
  const { dialog, submit } = await confirmDelete(user)
  const refreshed = { ...session, access_token: 'mock-refreshed-owner-access' }
  vi.mocked(client.auth.getSession)
    .mockResolvedValueOnce({ data: { session: refreshed }, error: null })
    .mockResolvedValue({ data: { session: otherSession }, error: null })
  await submit()
  expect(await dialog.findByRole('alert')).toHaveTextContent(/로그인 계정이 바뀌었어요/)
  const [[, request]] = deleteRequests()
  expect(new Headers(request?.headers).get('Authorization')).toBe(
    'Bearer mock-refreshed-owner-access',
  )
  expect(screen.queryByText('프로젝트를 삭제했습니다.')).not.toBeInTheDocument()
})

it('삭제 응답 전에 다른 계정으로 갔다 돌아와도 늦은 성공으로 이동하지 않는다', async () => {
  const { cache, user } = show()
  const { dialog, submit } = await confirmDelete(user)
  const response = Promise.withResolvers<Response>()
  deleteResponse = () => response.promise
  let notify: Parameters<typeof client.auth.onAuthStateChange>[0] | undefined
  const unsubscribe = vi.fn()
  vi.spyOn(client.auth, 'onAuthStateChange').mockImplementation((callback) => {
    notify = callback
    return { data: { subscription: { id: 'unit-test', callback, unsubscribe } } }
  })
  await submit()
  await waitFor(() => expect(deleteRequests()).toHaveLength(1))
  await act(async () => {
    await notify?.('SIGNED_IN', otherSession)
    await notify?.('SIGNED_IN', session)
    response.resolve(Response.json(projectId))
  })
  expect(await dialog.findByRole('alert')).toHaveTextContent(/로그인 계정이 바뀌었어요/)
  expect(deleteRequests()[0][1]?.signal?.aborted).toBe(true)
  expect(cache.getQueryData(projectKey(ownerId, projectId))).toEqual(project)
  expect(screen.queryByText('프로젝트를 삭제했습니다.')).not.toBeInTheDocument()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
