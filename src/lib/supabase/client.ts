import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

function isPublicKey(key: string) {
  if (key.startsWith('sb_publishable_')) return true
  if (!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(key)) return false
  try {
    const [, encoded] = key.split('.')
    return (
      (JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string })
        .role === 'anon'
    )
  } catch {
    return false
  }
}

function isAllowedUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
  } catch {
    return false
  }
}

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
const supabase =
  isAllowedUrl(url) && isPublicKey(key)
    ? createClient<Database>(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: false } })
    : null

export const isSupabaseConfigured = supabase !== null

export function getSupabase() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED')
  return supabase
}
