import { ArrowRight, FolderOpen, Plus, UserRound } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { Loading, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-provider'
import { useMyProfile } from '../profiles/profile-api'
import { ProjectCard } from '../projects/ProjectCard'
import { useMyProjects } from '../projects/project-api'
import { SchoolVerification } from '../universities/SchoolVerification'

export function DashboardPage() {
  const user = useAuth().session!.user
  const state = useLocation().state as { projectDeletedFor?: string } | null
  const profile = useMyProfile(user.id)
  const projects = useMyProjects(user.id)
  const remaining = projects.data?.filter((project) => project.status !== 'completed') ?? []
  const completed = projects.data?.filter((project) => project.status === 'completed') ?? []
  return (
    <main className="container page" id="main-content">
      <div className="section-heading dashboard-title">
        <PageHeading
          label="내 대시보드"
          title={`${profile.data?.nickname ?? '학생'}님, 반가워요.`}
          description="참여 중인 프로젝트와 학교 인증 상태를 확인하세요."
        />
        <Button asChild>
          <Link to="/projects/new">
            <Plus size={19} aria-hidden="true" />새 프로젝트
          </Link>
        </Button>
      </div>
      {state?.projectDeletedFor === user.id && (
        <div className="mb-4">
          <Notice kind="success">프로젝트를 삭제했습니다.</Notice>
        </div>
      )}
      <div className="dashboard-grid">
        <div className="flow">
          <section className="flow" aria-labelledby="my-projects-title">
            <div className="section-heading">
              <h2 id="my-projects-title">내 프로젝트</h2>
              {projects.data && <span className="chip">{remaining.length}개</span>}
            </div>
            {projects.isPending ? (
              <Loading />
            ) : projects.isError ? (
              <Notice kind="error">
                프로젝트를 불러오지 못했습니다.{' '}
                <button className="text-link" onClick={() => void projects.refetch()}>
                  다시 시도
                </button>
              </Notice>
            ) : remaining.length ? (
              <ul className="project-grid dashboard-projects">
                {remaining.map((item) => (
                  <ProjectCard key={item.id} project={item} role={item.membership_role} />
                ))}
              </ul>
            ) : (
              <div className="panel empty-state">
                <FolderOpen size={24} aria-hidden="true" />
                <div>
                  <strong>
                    {completed.length
                      ? '완료하지 않은 프로젝트가 없어요.'
                      : '아직 참여 중인 프로젝트가 없어요.'}
                  </strong>
                  <p>팀과 함께할 프로젝트를 만들거나 팀장의 초대 링크로 합류해 보세요.</p>
                </div>
              </div>
            )}
          </section>
          {!projects.isError && completed.length > 0 && (
            <section className="flow" aria-labelledby="completed-projects-title">
              <div className="section-heading">
                <h2 id="completed-projects-title">완료한 프로젝트</h2>
                <span className="chip">{completed.length}개</span>
              </div>
              <ul className="project-grid dashboard-projects">
                {completed.map((item) => (
                  <ProjectCard key={item.id} project={item} role={item.membership_role} />
                ))}
              </ul>
            </section>
          )}
        </div>
        <aside className="flow" aria-label="내 계정 상태">
          <h2>내 계정</h2>
          <SchoolVerification userId={user.id} email={user.email} />
          <Link to={`/profile/${user.id}`} className="panel shortcut">
            <UserRound size={19} aria-hidden="true" />
            <span>내 프로필 보기</span>
            <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </main>
  )
}
