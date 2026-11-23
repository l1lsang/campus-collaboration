import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Compass,
  GitBranchPlus,
  Handshake,
  Network,
  PanelTop,
  Plus,
} from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { Loading, Notice } from '../../components/common/states'
import { brand } from '../../lib/constants/brand'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../auth/auth-provider'
import { useUniversities } from '../profiles/profile-api'
import { ProjectCard } from '../projects/ProjectCard'
import { usePublicProjects } from '../projects/project-api'

const stages = [
  {
    title: '프로젝트 발견',
    text: '다른 전공과 캠퍼스에서 어떤 프로젝트를 만드는지 살펴보세요.',
    status: '지금 가능',
  },
  {
    title: '팀 구성',
    text: '프로젝트를 만들고 함께할 학생에게 초대 링크를 보내세요.',
    status: '지금 가능',
  },
  {
    title: '함께 실행',
    text: '팀플로그에서 업무와 진행 기록을 공유할 수 있도록 준비하고 있어요.',
    status: '다음 단계',
  },
  {
    title: '검증과 회고',
    text: '사용자 테스트와 회고를 통해 다음 프로젝트에 경험을 남깁니다.',
    status: '예정',
  },
]

export function LandingPage() {
  const { session } = useAuth()
  const schools = useUniversities(isSupabaseConfigured)
  const projects = usePublicProjects()
  return (
    <main id="main-content" className="landing">
      <section className="hero container">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span aria-hidden="true" /> 대학생 협업 플랫폼
          </span>
          <h1>
            학교는 달라도,
            <br />
            <span>함께 만들 수 있어요.</span>
          </h1>
          <p>
            혼자서는 시작하기 어려웠던 아이디어, 다른 전공의 학생과 함께 프로젝트로 옮겨 보세요.
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link to={session ? '/projects/new' : '/signup'}>
                {session ? '새 프로젝트' : '프로젝트 시작하기'}{' '}
                <ArrowRight size={19} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/explore">프로젝트 둘러보기</Link>
            </Button>
          </div>
        </div>
        <div className="hero-board" aria-hidden="true">
          <div className="board-caption">
            <span>
              <PanelTop size={16} /> 팀플로그
            </span>
            <span>프로젝트를 만드는 순서</span>
          </div>
          <div className="board-map">
            <div className="map-node node-idea">
              <span>
                <GitBranchPlus size={23} />
              </span>
              <div>
                <small>01 · 시작점</small>
                <strong>해결하고 싶은 문제</strong>
              </div>
            </div>
            <ArrowDown className="map-arrow arrow-one" size={20} />
            <div className="map-node node-team">
              <span>
                <Handshake size={23} />
              </span>
              <div>
                <small>02 · 연결</small>
                <strong>서로 다른 전공의 팀원</strong>
              </div>
            </div>
            <ArrowDown className="map-arrow arrow-two" size={20} />
            <div className="map-node node-project">
              <span>
                <Network size={24} />
              </span>
              <div>
                <small>03 · 함께</small>
                <strong>우리 팀의 프로젝트</strong>
              </div>
            </div>
          </div>
        </div>
      </section>
      {!!schools.data?.length && (
        <aside className="schools-bar">
          <div className="container schools-content">
            <p>초기 이용 대상</p>
            <ul>
              {schools.data.map((school) => (
                <li key={school.id}>{school.name}</li>
              ))}
            </ul>
          </div>
        </aside>
      )}
      <section className="container landing-section steps-section" aria-labelledby="steps-title">
        <div>
          <p className="eyebrow">협업의 네 단계</p>
          <h2 id="steps-title">
            아이디어가 팀을
            <br className="desktop-only" /> 만나는 과정
          </h2>
          <p className="muted steps-lead">
            부족한 역량을 채워 줄 팀원을 찾고, 둘 이상이 함께 만들 수 있는 일에 도전하세요.
          </p>
        </div>
        <ol className="step-list">
          {stages.map((stage, index) => (
            <li key={stage.title}>
              <span className="step-index">0{index + 1}</span>
              <div>
                <h3>{stage.title}</h3>
                <p>{stage.text}</p>
              </div>
              <span className={index < 2 ? 'chip chip-primary' : 'chip'}>{stage.status}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="project-band" aria-labelledby="public-projects-title">
        <div className="container landing-section flow">
          <div className="section-heading">
            <div>
              <p className="eyebrow">프로젝트 탐색</p>
              <h2 id="public-projects-title">최근 공개 프로젝트</h2>
            </div>
            <Link className="action-link" to="/explore">
              전체 둘러보기 <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
          {!isSupabaseConfigured ? (
            <Notice>Supabase를 연결하면 실제 공개 프로젝트가 여기에 표시됩니다.</Notice>
          ) : projects.isPending ? (
            <Loading />
          ) : projects.isError ? (
            <Notice kind="error">
              프로젝트를 불러오지 못했습니다.{' '}
              <button className="text-link" onClick={() => void projects.refetch()}>
                다시 시도
              </button>
            </Notice>
          ) : projects.data.length ? (
            <ul className="project-grid">
              {projects.data.slice(0, 3).map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </ul>
          ) : (
            <div className="panel empty-state">
              <Compass size={24} aria-hidden="true" />
              <div>
                <strong>아직 공개된 프로젝트가 없어요.</strong>
                <p>직접 첫 프로젝트를 만들어 보세요.</p>
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="container landing-section">
        <div className="closing">
          <div>
            <p className="eyebrow">{brand.workspace}에서 시작하세요</p>
            <h2>함께할 일이 떠올랐나요?</h2>
            <p>첫 프로젝트를 만들고 팀원에게 초대 링크를 보내 보세요.</p>
          </div>
          <Button asChild>
            <Link to={session ? '/projects/new' : '/signup'}>
              <Plus size={19} aria-hidden="true" />
              {session ? '새 프로젝트' : '가입하고 시작하기'}
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
