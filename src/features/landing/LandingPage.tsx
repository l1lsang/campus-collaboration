import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useUniversities } from '../profiles/profile-api'
import { ProjectCard } from '../projects/ProjectCard'
import { usePublicProjects } from '../projects/project-api'

const shortcuts = [
  { title: '협업 모집', detail: '반쪽 아이디어, 리부트, 공모전 팀', to: '/opportunities' },
  { title: '품앗이', detail: '설문과 사용자 테스트 참여', to: '/research' },
  { title: '경험 아카이브', detail: '다른 팀이 공개한 회고와 인수인계', to: '/archive' },
]

export function LandingPage() {
  const schools = useUniversities(isSupabaseConfigured)
  const projects = usePublicProjects()

  return (
    <main id="main-content" className="container page campus-home">
      <header className="home-intro">
        <h1>대학생 프로젝트와 팀원 모집</h1>
        <p>팀플이나 공모전에 같이할 사람을 찾고, 만들던 프로젝트를 이어가세요.</p>
        <div className="wrap">
          <Button asChild>
            <Link to="/opportunities">
              협업 모집 보기 <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/explore">프로젝트 둘러보기</Link>
          </Button>
        </div>
      </header>

      <div className="home-grid">
        <section aria-labelledby="public-projects-title" className="flow">
          <div className="section-heading">
            <h2 id="public-projects-title">최근 공개 프로젝트</h2>
            <Link className="action-link" to="/explore">
              전체 보기 <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {!isSupabaseConfigured ? (
            <Notice>프로젝트 목록을 표시하려면 데이터베이스 연결이 필요합니다.</Notice>
          ) : projects.isPending ? (
            <Loading label="프로젝트 불러오는 중…" />
          ) : projects.isError ? (
            <Notice kind="error">
              프로젝트를 불러오지 못했습니다.{' '}
              <button className="text-link" onClick={() => void projects.refetch()}>
                다시 시도
              </button>
            </Notice>
          ) : projects.data.length ? (
            <ul className="project-list">
              {projects.data.slice(0, 5).map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </ul>
          ) : (
            <div className="home-empty">
              <p>아직 공개된 프로젝트가 없어요.</p>
              <p className="muted">
                팀을 찾고 있다면{' '}
                <Link to="/opportunities" className="text-link">
                  협업 모집
                </Link>
                을 확인하세요.
              </p>
            </div>
          )}
        </section>
        <aside className="home-aside" aria-label="바로가기와 이용 대상">
          <nav aria-labelledby="home-shortcuts-title">
            <h2 id="home-shortcuts-title">바로가기</h2>
            <ul className="home-shortcuts">
              {shortcuts.map(({ title, detail, to }) => (
                <li key={to}>
                  <Link to={to}>
                    <span>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {!!schools.data?.length && (
            <section className="home-schools" aria-labelledby="home-schools-title">
              <h2 id="home-schools-title">이용 대상</h2>
              <p>
                {schools.data.map((school) => school.name).join(' · ')} Google 계정으로 참여할 수
                있습니다.
              </p>
            </section>
          )}
        </aside>
      </div>
    </main>
  )
}
