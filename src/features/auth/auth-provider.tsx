import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'

type AuthState = {
  session: Session | null
  loading: boolean
  schoolId: string | null
  status: 'loading' | 'signed-out' | 'verified' | 'denied' | 'error'
  retryVerification: () => void
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  schoolId: null,
  status: 'loading',
  retryVerification: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [rawSession, setRawSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(isSupabaseConfigured)
  const [attempt, setAttempt] = useState(0)
  const [checked, setChecked] = useState<{
    userId: string
    accessToken: string | undefined
    attempt: number
    schoolId: string | null
    failed: boolean
  } | null>(null)
  const userId = rawSession?.user.id
  const accessToken = rawSession?.access_token

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let previousUser: string | undefined
    const {
      data: { subscription },
    } = getSupabase().auth.onAuthStateChange((_event, nextSession) => {
      const nextUser = nextSession?.user.id
      if (previousUser && previousUser !== nextUser)
        queryClient.removeQueries({ queryKey: ['account', previousUser] })
      previousUser = nextUser
      setRawSession(nextSession)
      if (!nextSession) setChecked(null)
      setInitializing(false)
    })
    return () => subscription.unsubscribe()
  }, [queryClient])

  useEffect(() => {
    if (!userId) return
    const check = { userId, accessToken, attempt }
    let current = true
    // A separate effect avoids re-entering the Supabase Auth client from its event listener.
    async function verify() {
      try {
        const { data, error } = await getSupabase().rpc('my_university_verification')
        if (error) throw error
        if (current) setChecked({ ...check, schoolId: data ?? null, failed: false })
      } catch {
        if (current) setChecked({ ...check, schoolId: null, failed: true })
      }
    }
    void verify()
    return () => {
      current = false
    }
  }, [userId, accessToken, attempt])

  const result =
    checked?.userId === userId &&
    checked?.accessToken === accessToken &&
    checked?.attempt === attempt
      ? checked
      : null
  const loading = initializing || Boolean(rawSession && !result)
  const schoolId = result?.schoolId ?? null
  let status: AuthState['status'] = 'signed-out'
  if (loading) status = 'loading'
  else if (result?.failed) status = 'error'
  else if (schoolId) status = 'verified'
  else if (rawSession) status = 'denied'

  return (
    <AuthContext.Provider
      value={{
        session: schoolId ? rawSession : null,
        loading,
        schoolId,
        status,
        retryVerification: () => setAttempt((n) => n + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
