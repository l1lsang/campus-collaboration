import { ArrowRight, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { Loading, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-provider'

import { ProjectCard } from '../projects/ProjectCard'
import { useMyProjects } from '../projects/project-api'
import { SchoolVerification } from '../universities/SchoolVerification'

export function DashboardPage() {
  const user = useAuth().session!.user

  const projects = useMyProjects(user.id)
  return (
    <main className="container page" id="main-content">
      <div className="section-heading dashboard-title">
        <PageHeading title="내 프로젝트" />
        <Button asChild>
          <Link to="/projects/new">
            <Plus size={19} aria-hidden="true" />새 프로젝트
          </Link>
        </Button>
      </div>
      <div className="dashboard-grid">
        <section className="flow" aria-labelledby="my-projects-title">
          <div className="section-heading">
            <h2 id="my-projects-title">참여 목록</h2>
            {projects.data && <span className="muted">{projects.data.length}개</span>}
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
          ) : projects.data.length ? (
            <ul className="project-list">
              {projects.data.map((item) => (
                <ProjectCard key={item.id} project={item} role={item.membership_role} />
              ))}
            </ul>
          ) : (
            <div className="home-empty">
              <p>아직 참여 중인 프로젝트가 없어요.</p>
              <p className="muted">새 프로젝트를 만들거나 팀장의 초대 링크로 합류할 수 있습니다.</p>
            </div>
          )}
        </section>
        <aside className="flow" aria-label="내 계정 상태">
          <h2>내 계정</h2>
          <SchoolVerification userId={user.id} email={user.email} />
          <Link to={`/profile/${user.id}`} className="action-link">
            내 프로필 보기 <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </main>
  )
}
