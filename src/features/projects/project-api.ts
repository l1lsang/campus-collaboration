import { useQuery } from '@tanstack/react-query'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'
import type { Tables } from '../../lib/supabase/database.types'
import type { ProjectFormValues } from '../../lib/validations/forms'

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
  return useQuery({
    queryKey: myProjectsKey(userId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('project_members')
        .select(`membership_role, projects!inner(${summaryColumns})`)
        .eq('user_id', userId)
        .order('joined_at', { ascending: false })
      if (error) throw error
      return data.map((row) => ({ ...row.projects, membership_role: row.membership_role }))
    },
  })
}

export function useProject(id: string, userId?: string) {
  return useQuery({
    queryKey: projectKey(userId, id),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('projects')
        .select(summaryColumns)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
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
