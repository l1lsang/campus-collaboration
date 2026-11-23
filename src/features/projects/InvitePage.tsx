import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { UsersRound } from 'lucide-react'
import { Loading, Notice, PageHeading, Unconfigured } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { userError } from '../../lib/supabase/errors'
import { AuthVerificationError } from '../auth/AuthVerificationError'
import { useAuth } from '../auth/auth-provider'
import { authReturnPath, getInviteToken } from '../auth/return-path'
import { useMyProfile } from '../profiles/profile-api'
import { SchoolVerification } from '../universities/SchoolVerification'
import { acceptInvite, myProjectsKey, projectKey } from './project-api'

export function InvitePage() {
  const location = useLocation()
  const token = getInviteToken(location.hash)
  const { session, loading, status } = useAuth()
  const next = authReturnPath(`/invite${location.hash}`)
  return (
    <main className="narrow page" id="main-content">
      <PageHeading
        label="팀플로그 · 초대"
        title="프로젝트에 초대받았어요"
        description="팀에 합류하면 프로젝트 소개와 팀원 목록을 볼 수 있습니다."
      />
      {!token ? (
        <Notice kind="error">
          초대 주소가 올바르지 않습니다. 팀장에게 새 링크를 요청해 주세요.
        </Notice>
      ) : !isSupabaseConfigured ? (
        <Unconfigured />
      ) : loading ? (
        <Loading />
      ) : status === 'error' ? (
        <AuthVerificationError />
      ) : !session ? (
        <div className="panel flow">
          <h2>로그인하고 팀에 참여하세요</h2>
          {status === 'denied' && (
            <Notice kind="error">
              등록된 학교의 Google Workspace 계정으로 다시 로그인해 주세요.
            </Notice>
          )}
          <p className="muted">학교 Google 계정으로 접속하면 이 초대 화면으로 돌아옵니다.</p>
          <Button asChild>
            <Link to="/login" state={{ next }}>
              학교 Google 계정으로 로그인
            </Link>
          </Button>
        </div>
      ) : (
        <InviteCheck userId={session.user.id} token={token} next={next} />
      )}
    </main>
  )
}

function InviteCheck({ userId, token, next }: { userId: string; token: string; next: string }) {
  const profile = useMyProfile(userId)
  if (profile.isPending) return <Loading />
  if (profile.isError)
    return (
      <Notice kind="error">
        프로필을 불러오지 못했습니다.{' '}
        <button className="text-link" onClick={() => void profile.refetch()}>
          다시 시도
        </button>
      </Notice>
    )
  if (!profile.data) return <Navigate to="/onboarding" replace state={{ next }} />
  return (
    <SchoolVerification userId={userId}>
      <AcceptInvite userId={userId} token={token} />
    </SchoolVerification>
  )
}

function AcceptInvite({ userId, token }: { userId: string; token: string }) {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: (id) => {
      void cache.invalidateQueries({ queryKey: myProjectsKey(userId) })
      void cache.invalidateQueries({ queryKey: projectKey(userId, id) })
      void navigate(`/projects/${id}`, { replace: true })
    },
  })
  return (
    <section className="panel flow">
      <h2>팀에 합류할까요?</h2>
      <p className="muted">수락하면 프로젝트 팀원에게 닉네임과 프로젝트 역할이 공개됩니다.</p>
      {mutation.error && (
        <Notice kind="error">
          {userError(mutation.error, '초대를 수락하지 못했습니다. 다시 시도해 주세요.')}
        </Notice>
      )}
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        <UsersRound size={18} aria-hidden="true" />
        {mutation.isPending ? '참여 중…' : '프로젝트 참여'}
      </Button>
    </section>
  )
}
