import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '../../lib/supabase/client'
import { parseTags, type ProfileFormValues } from '../../lib/validations/forms'

export const profileKey = (id: string) => ['account', id, 'profile'] as const
export const verificationKey = (id: string) => ['account', id, 'school-verification'] as const

export function useMyProfile(id: string) {
  return useQuery({
    queryKey: profileKey(id),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function usePublicProfile(id: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['account', userId ?? 'guest', 'view-profile', id],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('profiles')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useUniversities(enabled = true) {
  return useQuery({
    queryKey: ['public', 'universities'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('universities')
        .select('id,name,short_name')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

export function useSchoolVerification(id: string, enabled = true) {
  return useQuery({
    queryKey: verificationKey(id),
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('my_university_verification')
      if (error) throw error
      return data ?? null
    },
  })
}

export async function verifySchool() {
  const { data, error } = await getSupabase().rpc('verify_university_email')
  if (error) throw error
  if (!data) throw new Error('CONFIRMED_EMAIL_REQUIRED')
  return data
}

export async function saveProfile(id: string, values: ProfileFormValues, existing: boolean) {
  const fields = {
    nickname: values.nickname,
    university_id: values.universityId,
    major: values.major,
    bio: values.bio,
    skills: parseTags(values.skills),
    interests: parseTags(values.interests),
    preferred_category: values.preferredCategory,
    visibility: values.visibility,
  }
  const table = getSupabase().from('profiles')
  const request = existing ? table.update(fields).eq('id', id) : table.insert({ id, ...fields })
  const { data, error } = await request.select('*').single()
  if (error) throw error
  return data
}
