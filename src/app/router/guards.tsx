import { Navigate, Outlet, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { Loading, Notice } from '../../components/common/states'
import { AuthVerificationError } from '../../features/auth/AuthVerificationError'
import { useAuth } from '../../features/auth/auth-provider'
import { authReturnPath } from '../../features/auth/return-path'
import { useMyProfile } from '../../features/profiles/profile-api'

export function RequireAuth() {
  const { session, loading, status } = useAuth()
  const { pathname } = useLocation()
  if (loading)
    return (
      <main className="container page" id="main-content">
        <Loading label="로그인 상태 확인 중…" />
      </main>
    )
  if (status === 'error')
    return (
      <main className="container page" id="main-content">
        <AuthVerificationError />
      </main>
    )
  if (!session) return <Navigate to="/login" replace state={{ next: authReturnPath(pathname) }} />
  return <Outlet />
}

export function RequireProfile({
  verificationFailure,
  waitForInitialRefresh = false,
}: {
  verificationFailure?: ReactNode
  waitForInitialRefresh?: boolean
}) {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const profile = useMyProfile(session!.user.id)
  const refreshing =
    waitForInitialRefresh && !profile.isFetchedAfterMount && profile.fetchStatus !== 'idle'
  if (profile.isPending || refreshing)
    return (
      <main className="container page" id="main-content">
        <Loading label="프로필 확인 중…" />
      </main>
    )
  if (profile.isError)
    return (
      <main className="container page" id="main-content">
        {verificationFailure}
        <Notice kind="error">
          프로필을 불러오지 못했습니다.{' '}
          <button className="text-link" onClick={() => void profile.refetch()}>
            다시 시도
          </button>
        </Notice>
      </main>
    )
  if (!profile.data)
    return <Navigate to="/onboarding" replace state={{ next: authReturnPath(pathname) }} />
  return <Outlet />
}
