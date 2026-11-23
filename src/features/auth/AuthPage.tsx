import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { Button } from '../../components/ui/button'
import { Loading, Notice, PageHeading, Unconfigured } from '../../components/common/states'
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase/client'
import { AuthVerificationError } from './AuthVerificationError'
import {
  authReturnPath,
  clearAuthReturnPath,
  readAuthReturnPath,
  rememberAuthReturnPath,
} from './return-path'
import { useAuth } from './auth-provider'

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { session, loading, status } = useAuth()
  const location = useLocation()
  const next = authReturnPath((location.state as { next?: unknown } | null)?.next)
  const isSignup = mode === 'signup'
  const [error, setError] = useState(false)
  const [starting, setStarting] = useState(false)

  async function startGoogle() {
    setError(false)
    setStarting(true)
    try {
      rememberAuthReturnPath(next)
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: new URL('/auth/callback', window.location.origin).href,
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) throw error
    } catch {
      clearAuthReturnPath()
      setError(true)
      setStarting(false)
    }
  }

  if (loading)
    return (
      <main className="container page" id="main-content">
        <Loading label="로그인 상태 확인 중…" />
      </main>
    )
  if (session) return <Navigate replace to={next} />

  return (
    <main className="narrow page auth-page" id="main-content">
      <PageHeading
        title={isSignup ? '회원가입' : '로그인'}
        description="학교에서 발급한 Google 계정을 사용하세요. 개인 Gmail로는 로그인할 수 없습니다."
      />
      {!isSupabaseConfigured ? (
        <Unconfigured />
      ) : (
        <div className="auth-options flow">
          {status === 'denied' && (
            <Notice kind="error">등록된 학교의 Google 계정으로 다시 로그인해 주세요.</Notice>
          )}
          {status === 'error' && <AuthVerificationError />}
          {error && (
            <Notice kind="error">Google 로그인을 시작하지 못했습니다. 다시 시도해 주세요.</Notice>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={starting}
            onClick={() => void startGoogle()}
          >
            {starting ? 'Google로 이동 중…' : '학교 Google 계정으로 계속하기'}
          </Button>
        </div>
      )}
      <p className="auth-switch">
        {isSignup ? '이미 계정이 있나요?' : '처음 오셨나요?'}{' '}
        <Link to={isSignup ? '/login' : '/signup'} state={{ next }}>
          {isSignup ? '로그인' : '회원가입'}
        </Link>
      </p>
    </main>
  )
}

async function exchangeGoogleCode(code: string) {
  try {
    const { data, error } = await getSupabase().auth.exchangeCodeForSession(code)
    return error ? null : (data.session?.user.id ?? null)
  } catch {
    return null
  }
}

export function AuthCallbackPage() {
  const { search, hash } = useLocation()
  const { loading, session, status } = useAuth()
  const [next] = useState(readAuthReturnPath)
  const [result, setResult] = useState<{ code: string; userId: string | null } | null>(null)
  const exchange = useRef<{ code: string; task: Promise<string | null> } | null>(null)
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.slice(1))
  const code = query.get('code')
  const providerError = [query, fragment].some((params) =>
    ['error', 'error_code', 'error_description'].some((key) => params.has(key)),
  )

  useEffect(() => {
    if (!isSupabaseConfigured || providerError || !code) return
    // Effect replay must not exchange a single-use PKCE code twice.
    if (exchange.current?.code !== code) exchange.current = { code, task: exchangeGoogleCode(code) }
    let active = true
    void exchange.current.task.then((userId) => {
      if (active) setResult({ code, userId })
    })
    return () => {
      active = false
    }
  }, [code, providerError])

  const completed = result?.code === code ? result : null
  let error = ''
  if (providerError)
    error = 'Google 로그인이 취소되었거나 거부되었습니다. 등록된 학교 계정을 확인해 주세요.'
  else if (!code || (completed && !completed.userId))
    error = 'Google 로그인을 완료하지 못했습니다. 처음부터 다시 시도해 주세요.'
  else if (completed && !loading && status === 'denied')
    error = '학교 계정 인증에 실패했습니다. 등록된 학교의 Google Workspace 계정이 필요합니다.'
  else if (completed && !loading && status !== 'error' && session?.user.id !== completed.userId)
    error = '로그인 세션을 확인하지 못했습니다. 처음부터 다시 시도해 주세요.'

  const ready = !error && Boolean(completed?.userId && completed.userId === session?.user.id)
  const finished = ready || Boolean(error)
  useEffect(() => {
    if (finished) clearAuthReturnPath()
  }, [finished])

  if (ready) return <Navigate replace to={next} />
  return (
    <main className="narrow page auth-page" id="main-content">
      <PageHeading title="Google 로그인 확인" />
      {!isSupabaseConfigured ? (
        <Unconfigured />
      ) : error ? (
        <div className="panel flow">
          <Notice kind="error">{error}</Notice>
          <Button asChild>
            <Link to="/login" state={{ next }} replace>
              로그인 다시 시작
            </Link>
          </Button>
        </div>
      ) : completed && status === 'error' ? (
        <AuthVerificationError />
      ) : (
        <Loading label="학교 Google 계정 확인 중…" />
      )}
    </main>
  )
}
