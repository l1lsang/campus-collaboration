import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'

type AuthState = {
  session: Session | null
  loading: boolean
  schoolId: string | null
  status: 'loading' | 'signed-out' | 'verified' | 'denied' | 'error'
  verifiedSessionContinuity: number | null
  verificationVersion: number | null
  getVerifiedRequest: () => { accessToken: string; signal: AbortSignal } | null
  retryVerification: () => void
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  schoolId: null,
  status: 'loading',
  verifiedSessionContinuity: null,
  verificationVersion: null,
  getVerifiedRequest: () => null,
  retryVerification: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const currentCheck = useRef({ version: 0, controller: new AbortController() })
  const invalidateCheck = useCallback(() => {
    const previous = currentCheck.current
    const version = previous.version + 1
    currentCheck.current = { version, controller: new AbortController() }
    previous.controller.abort()
    return version
  }, [])
  const [{ rawSession, identity, version }, setSession] = useState({
    rawSession: null as Session | null,
    identity: 0,
    version: 0,
  })
  const [initializing, setInitializing] = useState(isSupabaseConfigured)
  const [attempt, setAttempt] = useState(0)
  const [checked, setChecked] = useState<{
    identity: number
    version: number
    attempt: number
    schoolId: string | null
    failed: boolean
  } | null>(null)
  const userId = rawSession?.user.id

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let previousUser: string | undefined
    let previousToken: string | undefined
    let identity = 0
    const {
      data: { subscription },
    } = getSupabase().auth.onAuthStateChange((event, nextSession) => {
      const nextUser = nextSession?.user.id
      const nextToken = nextSession?.access_token
      const userChanged = previousUser !== nextUser
      const credentialsChanged = userChanged || previousToken !== nextToken
      if (credentialsChanged) {
        const version = invalidateCheck()
        if (userChanged || event !== 'TOKEN_REFRESHED') identity = version
      }
      if (previousUser && userChanged)
        queryClient.removeQueries({ queryKey: ['account', previousUser] })
      previousUser = nextUser
      previousToken = nextToken
      setSession({ rawSession: nextSession, identity, version: currentCheck.current.version })
      if (!nextSession) setChecked(null)
      setInitializing(false)
    })
    return () => {
      subscription.unsubscribe()
      invalidateCheck()
    }
  }, [queryClient, invalidateCheck])

  useEffect(() => {
    if (!userId) return
    const check = { identity, version, attempt }
    let current = true
    // A separate effect avoids re-entering the Supabase Auth client from its event listener.
    async function verify() {
      try {
        const { data, error } = await getSupabase().rpc('my_university_verification')
        if (error) throw error
        if (current && currentCheck.current.version === version)
          setChecked({ ...check, schoolId: data ?? null, failed: false })
      } catch {
        if (current && currentCheck.current.version === version)
          setChecked({ ...check, schoolId: null, failed: true })
      }
    }
    void verify()
    return () => {
      current = false
    }
  }, [userId, identity, version, attempt])

  const result = checked?.version === version ? checked : null
  const loading = initializing || Boolean(rawSession && !result)
  const schoolId = result?.schoolId ?? null
  let status: AuthState['status'] = 'signed-out'
  if (loading) status = 'loading'
  else if (result?.failed) status = 'error'
  else if (schoolId) status = 'verified'
  else if (rawSession) status = 'denied'
  // This is a lifetime key, not authorization. Only a token change from a
  // previously verified identity can carry local state through a closed guard.
  const refreshingVerifiedSession =
    loading &&
    checked?.identity === identity &&
    checked.attempt === attempt &&
    Boolean(checked.schoolId)

  return (
    <AuthContext.Provider
      value={{
        session: schoolId ? rawSession : null,
        loading,
        schoolId,
        status,
        verifiedSessionContinuity:
          status === 'verified' || refreshingVerifiedSession ? identity : null,
        verificationVersion: status === 'verified' ? version : null,
        // Invalidate handlers and transport as soon as Auth emits, before React commits the guard.
        getVerifiedRequest: () => {
          const check = currentCheck.current
          const accessToken = rawSession?.access_token
          return status === 'verified' && check.version === version && accessToken
            ? { accessToken, signal: check.controller.signal }
            : null
        },
        retryVerification: () => {
          const version = invalidateCheck()
          setSession((session) => ({ ...session, version }))
          setAttempt((n) => n + 1)
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
