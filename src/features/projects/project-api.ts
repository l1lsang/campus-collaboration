import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'
import type { Tables } from '../../lib/supabase/database.types'
import type { ProjectFormValues } from '../../lib/validations/forms'
import { observeVerifiedSession } from '../auth/verified-session'
import { matchingKey } from '../matching/matching-api'
import { archiveKey, reportKinds, workspaceKey, type ReportKind } from '../reports/reports-api'
import { workbenchKey } from '../team/team-api'

export type ProjectSummary = Pick<
  Tables<'projects'>,
  | 'id'
  | 'title'
  | 'description'
  | 'category'
  | 'visibility'
  | 'status'
  | 'start_date'
  | 'due_date'
  | 'created_at'
>
const summaryColumns =
  'id,title,description,category,visibility,status,start_date,due_date,created_at' as const
export const publicProjectsKey = ['public', 'projects'] as const
export const myProjectsKey = (id: string) => ['account', id, 'projects'] as const
export const projectKey = (userId: string | undefined, projectId: string) =>
  ['account', userId ?? 'guest', 'project', projectId] as const

type MyProject = ProjectSummary & { membership_role: Tables<'project_members'>['membership_role'] }
export type ProjectManagementAction = 'complete' | 'delete'

function createOperations() {
  const active = new Map<string, string>()
  const unresolved = new Map<string, ProjectManagementAction>()
  const listeners = new Set<() => void>()
  return {
    active,
    unresolved,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify() {
      for (const listener of listeners) listener()
    },
  }
}

const operations = new WeakMap<QueryClient, ReturnType<typeof createOperations>>()

function getOperations(cache: QueryClient) {
  let store = operations.get(cache)
  if (!store) {
    store = createOperations()
    operations.set(cache, store)
  }
  return store
}

export function usePendingProjectWrite(userId?: string, id?: string) {
  const { active, subscribe } = getOperations(useQueryClient())
  return useSyncExternalStore(subscribe, () => {
    if (!userId) return false
    return id ? active.get(userId) === id : active.has(userId)
  })
}

export function useUnresolvedProjectWrite(userId: string, id: string) {
  const { unresolved, subscribe } = getOperations(useQueryClient())
  return useSyncExternalStore(subscribe, () => unresolved.get(`${userId}:${id}`))
}

const readbackDelays = [0, 250, 750]

function waitForReadback(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (!ms || signal.aborted) return resolve()
    const release = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', release)
      resolve()
    }
    const timer = setTimeout(release, ms)
    signal.addEventListener('abort', release, { once: true })
  })
}

export async function runProjectManagement(
  cache: QueryClient,
  action: ProjectManagementAction,
  project: ProjectSummary,
  userId: string,
  accessToken: string | undefined,
  ui: AbortSignal,
  onConfirmed: () => void,
  readOnly = false,
) {
  const projectId = project.id
  const scope = `${userId}:${projectId}`
  const { active, unresolved, notify } = getOperations(cache)
  // Serialize this account's writes so one readback cannot overwrite a newer project list.
  if (active.has(userId)) throw new Error('PROJECT_MANAGEMENT_CHECKING')
  if (readOnly ? unresolved.get(scope) !== action : unresolved.has(scope))
    throw new Error('PROJECT_MANAGEMENT_CHECKING')

  const client = getSupabase()
  const request = new AbortController()
  let latestToken = accessToken
  let verifiedToken = accessToken
  let uiInvalidated = false
  let needsReadback = false
  let responseConfirmed = false
  let settled = false
  let finished = false
  let readback: AbortController | undefined
  let recoveryDeadline: ReturnType<typeof setTimeout> | undefined
  active.set(userId, projectId)
  notify()
  const unobserve = observeVerifiedSession(cache, (session) => {
    if (!session) {
      pauseReadback()
    } else if (session.user.id === userId && session.access_token === latestToken) {
      verifiedToken = session.access_token
      reconcile()
    }
  })

  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') return
    if (session?.user.id !== userId) {
      request.abort()
      readback?.abort()
      // Releasing query observers can start queries; never do that inside the SDK listener.
      if (settled) setTimeout(() => finish(needsReadback), 0)
      return
    }
    observeToken(session.access_token)
  })

  function observeToken(token: string) {
    if (token === latestToken) return
    latestToken = token
    pauseReadback()
  }

  function pauseReadback() {
    verifiedToken = undefined
    uiInvalidated = true
    readback?.abort()
    readback = undefined
  }

  function finish(uncertain = false) {
    if (finished) return
    finished = true
    clearTimeout(recoveryDeadline)
    readback?.abort()
    readback = undefined
    if (uncertain) unresolved.set(scope, action)
    else unresolved.delete(scope)
    active.delete(userId)
    unobserve()
    subscription.unsubscribe()
    notify()
  }

  async function currentSession() {
    const { data, error } = await client.auth.getSession()
    if (request.signal.aborted || (!error && data.session?.user.id !== userId)) {
      request.abort()
      throw new Error('PROJECT_MANAGEMENT_ACCOUNT_CHANGED')
    }
    if (error) throw error
    if (!data.session?.access_token) throw new Error('PROJECT_MANAGEMENT_ACCOUNT_CHANGED')
    return data.session
  }

  function invalidateRelated(effectObserved: boolean) {
    clearProjectRecruitmentCache(cache, userId, project.visibility)
    if (!effectObserved) return
    if (project.visibility === 'public') {
      const publicDetail = { queryKey: projectKey(undefined, projectId), exact: true }
      void cache.cancelQueries(publicDetail)
      void cache.invalidateQueries({ ...publicDetail, refetchType: 'none' })
      void cache.invalidateQueries({ queryKey: publicProjectsKey, exact: true })
    }
    if (action === 'delete') invalidateDeletedProject(cache, userId, projectId)
  }

  function reconcile() {
    const token = verifiedToken
    if (!settled || !needsReadback || request.signal.aborted || !token || readback) return
    const controller = new AbortController()
    readback = controller
    const detailKey = projectKey(userId, projectId)
    const listKey = myProjectsKey(userId)
    const filters = [detailKey, listKey].map((queryKey) => ({ queryKey, exact: true }))

    async function stillVerified() {
      if (controller.signal.aborted) return false
      const current = await currentSession()
      if (controller.signal.aborted) return false
      observeToken(current.access_token)
      return !controller.signal.aborted
    }

    void (async () => {
      let complete = false
      try {
        await Promise.all(filters.map((filter) => cache.cancelQueries(filter)))
        let observed = responseConfirmed
        let refreshed = false
        let detailReady = false
        let listReady = false
        for (const delay of readbackDelays) {
          await waitForReadback(delay, controller.signal)
          if (!(await stillVerified())) return
          const pin = {
            token,
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
          }
          const [detail, list] = await Promise.allSettled([
            detailReady ? Promise.resolve(undefined) : loadProject(projectId, pin),
            listReady ? Promise.resolve(undefined) : loadMyProjects(userId, pin),
          ])
          if (!(await stillVerified())) return
          const newDetail = detail.status === 'fulfilled' ? detail.value : undefined
          const newList = list.status === 'fulfilled' ? list.value : undefined
          const listed = newList?.find((item) => item.id === projectId)
          const detailMatches =
            action === 'delete'
              ? newDetail === null
              : newDetail?.id === projectId && newDetail.status === 'completed'
          const listMatches =
            newList !== undefined &&
            (action === 'delete' ? !listed : listed?.status === 'completed')
          // An absent list entry alone does not show that the project was deleted.
          const effect = detailMatches || (action === 'complete' && listMatches)
          if (!refreshed || (!observed && effect)) {
            invalidateRelated(observed || effect)
            refreshed = true
          }
          observed ||= effect
          if (detailMatches) {
            cache.setQueryData(detailKey, newDetail)
            detailReady = true
          }
          if (listMatches && observed) {
            cache.setQueryData(listKey, newList)
            listReady = true
          }
          if (detailReady && listReady) {
            complete = true
            break
          }
        }
      } catch {
        // No inferred success on a session or transport error.
      } finally {
        // A second refresh pauses the readback until its own verification finishes.
        if (readback === controller) {
          if (!complete && !request.signal.aborted) {
            for (const filter of filters)
              void cache.invalidateQueries({ ...filter, refetchType: 'none' })
          }
          finish(!complete)
        }
      }
    })()
  }

  try {
    const { access_token: token } = await currentSession()
    if (ui.aborted || uiInvalidated || request.signal.aborted)
      throw new Error('PROJECT_MANAGEMENT_ACCOUNT_CHANGED')
    if (readOnly) {
      if (!verifiedToken || token !== verifiedToken)
        throw new Error('PROJECT_MANAGEMENT_ACCOUNT_CHANGED')
      needsReadback = true
      return
    }
    const args = { p_project_id: projectId, ...(action === 'delete' && { p_confirm: true }) }
    // Once dispatched, keep observing the write even if verification unmounts the dialog.
    needsReadback = true
    const { data, error, status } = await client
      .rpc((action === 'delete' ? 'delete_project' : 'complete_project') as never, args as never)
      .setHeader('Authorization', `Bearer ${token}`)
      .abortSignal(AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]))
      .retry(false)
    const tokenBeforeCheck = latestToken
    const current = await currentSession()
    if (request.signal.aborted) throw new Error('PROJECT_MANAGEMENT_ACCOUNT_CHANGED')
    if (tokenBeforeCheck === latestToken) observeToken(current.access_token)
    if (error) {
      if (status >= 400 && status < 500 && status !== 408 && status !== 499) needsReadback = false
      throw error
    }
    if (data !== projectId) throw new Error('PROJECT_MANAGEMENT_UNCONFIRMED')
    responseConfirmed = true
    if (!ui.aborted && !uiInvalidated && current.access_token === token) {
      needsReadback = false
      onConfirmed()
    }
  } finally {
    settled = true
    if (needsReadback && !request.signal.aborted) {
      recoveryDeadline = setTimeout(() => finish(true), 15_000)
      reconcile()
    } else finish(readOnly || needsReadback)
  }
}

export function updateProjectManagementCache(
  cache: QueryClient,
  action: ProjectManagementAction,
  userId: string,
  project: ProjectSummary,
) {
  const { id } = project
  const complete = <T extends ProjectSummary>(item: T): T => ({ ...item, status: 'completed' })
  const updateList = <T extends ProjectSummary>(items: T[] | undefined) =>
    action === 'delete'
      ? items?.filter((item) => item.id !== id)
      : items?.map((item) => (item.id === id ? complete(item) : item))
  const update = <T>(
    queryKey: readonly unknown[],
    updater: (previous: T | undefined) => T | undefined,
  ) => {
    const filters = { queryKey, exact: true }
    void cache.cancelQueries(filters)
    cache.setQueriesData<T>(filters, updater)
  }
  const updateDetail = (user: string | undefined) => {
    const key = projectKey(user, id)
    update<ProjectSummary | null>(key, (item) =>
      action === 'delete' ? null : item && complete(item),
    )
    if (action === 'delete' && !user) {
      cache.removeQueries({
        queryKey: key,
        predicate: (query) => query.queryKey.length > key.length,
      })
    }
  }
  updateDetail(userId)
  update<MyProject[]>(myProjectsKey(userId), updateList)
  if (project.visibility === 'public') {
    updateDetail(undefined)
    update<ProjectSummary[]>(publicProjectsKey, updateList)
  }
  clearProjectRecruitmentCache(cache, userId, project.visibility)
  if (action === 'delete') {
    invalidateDeletedProject(cache, userId, id)
  }
}

function clearProjectRecruitmentCache(
  cache: QueryClient,
  userId: string,
  visibility: ProjectSummary['visibility'],
) {
  const key = matchingKey(userId)
  for (const section of ['board', 'requests']) {
    const queryKey = [...key, section]
    cache.removeQueries({ queryKey, type: 'inactive' })
    // Removing an observed query would leave its old result on screen.
    void cache.resetQueries({ queryKey, type: 'active' })
  }
  if (visibility === 'public') void cache.invalidateQueries({ queryKey: [...key, 'sources'] })
}

function invalidateDeletedProject(cache: QueryClient, userId: string, projectId: string) {
  const key = projectKey(userId, projectId)
  cache.removeQueries({ queryKey: key, predicate: (query) => query.queryKey.length > key.length })
  for (const kind of Object.keys(reportKinds) as ReportKind[]) {
    cache.removeQueries({
      queryKey: workspaceKey(userId, { p_project_id: projectId, p_kind: kind }),
    })
  }
  cache.removeQueries({ queryKey: workbenchKey({ userId, projectId }) })
  void cache.invalidateQueries({ queryKey: archiveKey, exact: true })
}

export function usePublicProjects() {
  return useQuery({
    queryKey: publicProjectsKey,
    enabled: isSupabaseConfigured,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('projects')
        .select(summaryColumns)
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data
    },
  })
}

export function useMyProjects(userId: string) {
  const pendingWrite = usePendingProjectWrite(userId)
  return useQuery({
    queryKey: myProjectsKey(userId),
    enabled: !pendingWrite,
    queryFn: () => loadMyProjects(userId),
  })
}

type ReadbackAuth = { token: string; signal: AbortSignal }

async function loadMyProjects(userId: string, auth?: ReadbackAuth): Promise<MyProject[]> {
  const query = getSupabase()
    .from('project_members')
    .select(`membership_role, projects!inner(${summaryColumns})`)
    .eq('user_id', userId)
    .order('joined_at', { ascending: false })
  if (auth)
    query.setHeader('Authorization', `Bearer ${auth.token}`).abortSignal(auth.signal).retry(false)
  const { data, error } = await query
  if (error) throw error
  return data.map((row) => ({ ...row.projects, membership_role: row.membership_role }))
}

export function useProject(id: string, userId?: string) {
  const pendingWrite = usePendingProjectWrite(userId, id)
  return useQuery({
    queryKey: projectKey(userId, id),
    enabled: !pendingWrite,
    queryFn: () => loadProject(id),
  })
}

async function loadProject(id: string, auth?: ReadbackAuth) {
  const query = getSupabase().from('projects').select(summaryColumns).eq('id', id)
  if (auth)
    query.setHeader('Authorization', `Bearer ${auth.token}`).abortSignal(auth.signal).retry(false)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

export function useMembership(id: string, userId?: string) {
  return useQuery({
    queryKey: [...projectKey(userId, id), 'membership'],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('project_members')
        .select('membership_role')
        .eq('project_id', id)
        .eq('user_id', userId ?? '')
        .maybeSingle()
      if (error) throw error
      return data?.membership_role ?? null
    },
  })
}

export async function createProject(values: ProjectFormValues) {
  const { data, error } = await getSupabase().rpc('create_project', {
    p_title: values.title,
    p_description: values.description,
    p_category: values.category,
    p_visibility: values.visibility,
    ...(values.startDate && { p_start_date: values.startDate }),
    ...(values.dueDate && { p_due_date: values.dueDate }),
  })
  if (error) throw error
  if (!data) throw new Error('PROJECT_CREATE_FAILED')
  return data
}

export function useRoster(id: string, userId: string) {
  return useQuery({
    queryKey: [...projectKey(userId, id), 'roster'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_project_members', { p_project_id: id })
      if (error) throw error
      return data
    },
  })
}

export const invitesKey = (id: string, userId: string) =>
  [...projectKey(userId, id), 'invites'] as const

export function useInvites(id: string, userId: string) {
  return useQuery({
    queryKey: invitesKey(id, userId),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('list_project_invites', { p_project_id: id })
      if (error) throw error
      return data
    },
  })
}

export async function createInvite(id: string) {
  const { data, error } = await getSupabase()
    .rpc('create_project_invite', { p_project_id: id })
    .single()
  if (error) throw error
  return data
}

export async function revokeInvite(id: string) {
  const { error } = await getSupabase().rpc('revoke_project_invite', { p_invite_id: id })
  if (error) throw error
}

export async function acceptInvite(token: string) {
  const { data, error } = await getSupabase().rpc('accept_project_invite', { p_token: token })
  if (error) throw error
  if (!data) throw new Error('INVITE_UNAVAILABLE')
  return data
}
