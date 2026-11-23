import { GraduationCap, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { AuthVerificationError } from '../auth/AuthVerificationError'
import { useAuth } from '../auth/auth-provider'
import { useUniversities } from '../profiles/profile-api'

export function SchoolVerification({
  userId,
  children,
}: {
  userId: string
  email?: string
  children?: ReactNode
}) {
  const { session, schoolId, status, loading } = useAuth()
  const verified = Boolean(schoolId && session?.user.id === userId)
  const universities = useUniversities(verified && !children)
  if (loading) return <Loading label="학교 인증 상태 확인 중…" />
  if (status === 'error') return <AuthVerificationError />
  if (verified) {
    const school = universities.data?.find((item) => item.id === schoolId)
    return (
      children ?? (
        <Notice kind="success">
          <ShieldCheck size={18} aria-hidden="true" /> 학교 인증 완료
          {school ? ` · ${school.name}` : ''}
        </Notice>
      )
    )
  }
  return (
    <section className="panel flow verification-panel" aria-label="학교 인증">
      <div className="icon-tile">
        <GraduationCap size={22} aria-hidden="true" />
      </div>
      <h2>학교 인증이 필요합니다.</h2>
      <p className="muted">
        등록된 학교의 Google Workspace 계정으로 접속해야 프로젝트를 만들거나 팀에 참여할 수
        있습니다.
      </p>
      <Button asChild>
        <Link to="/login">학교 Google 계정으로 로그인</Link>
      </Button>
    </section>
  )
}
