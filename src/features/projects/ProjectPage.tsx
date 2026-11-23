import { ArrowLeft, CalendarDays, LockKeyhole, UsersRound } from 'lucide-react'
import { Link, NavLink, useParams } from 'react-router'
import { z } from 'zod'
import { Loading, Notice, PageHeading } from '../../components/common/states'
import { categoryLabel, brand } from '../../lib/constants/brand'
import { useAuth } from '../auth/auth-provider'
import { useMembership, useProject } from './project-api'
import { TeamPanel } from './TeamPanel'

const formatDate = (date: string | null) => (date ? date.replaceAll('-', '.') : '미정')

export function ProjectPage({ team = false }: { team?: boolean }) {
  const { id } = useParams()
  const auth = useAuth()
  if (auth.loading)
    return (
      <div className="container page">
        <Loading />
      </div>
    )
  if (!z.uuid().safeParse(id).success || !id)
    return (
      <main className="container page" id="main-content">
        <Notice kind="error">유효한 프로젝트 주소가 아닙니다.</Notice>
      </main>
    )
  return <ProjectContent id={id} userId={auth.session?.user.id} team={team} />
}

function ProjectContent({ id, userId, team }: { id: string; userId?: string; team: boolean }) {
  const project = useProject(id, userId)
  const membership = useMembership(id, userId)
  return (
    <main className="container page" id="main-content">
      <Link className="back-link" to={userId ? '/dashboard' : '/explore'}>
        <ArrowLeft size={16} aria-hidden="true" /> {userId ? '대시보드' : '프로젝트 탐색'}
      </Link>
      {project.isPending ? (
        <Loading />
      ) : project.isError ? (
        <Notice kind="error">
          프로젝트를 불러오지 못했습니다.{' '}
          <button className="text-link" onClick={() => void project.refetch()}>
            다시 시도
          </button>
        </Notice>
      ) : !project.data ? (
        <Notice>프로젝트가 없거나 볼 수 있는 권한이 없습니다.</Notice>
      ) : (
        <>
          <PageHeading
            title={project.data.title}
            label={brand.workspace}
            description={`${categoryLabel(project.data.category)} · ${project.data.visibility === 'private' ? '팀원 전용' : '공개 프로젝트'}`}
          />
          {membership.isError && (
            <Notice kind="error">
              팀원 권한을 확인하지 못했습니다.{' '}
              <button className="text-link" onClick={() => void membership.refetch()}>
                다시 시도
              </button>
            </Notice>
          )}
          <div className={membership.data ? 'workspace-grid' : 'workspace-grid workspace-public'}>
            {membership.data && (
              <nav className="workspace-nav" aria-label="프로젝트 메뉴">
                <NavLink end to={`/projects/${id}`}>
                  프로젝트 소개
                </NavLink>
                <NavLink to={`/projects/${id}/members`}>
                  <UsersRound size={18} aria-hidden="true" />
                  팀원 및 초대
                </NavLink>
                <NavLink to={`/projects/${id}/team`}>역할과 작업</NavLink>
                <NavLink to={`/projects/${id}/reports`}>보고서와 인수인계</NavLink>
              </nav>
            )}
            {team ? (
              userId && membership.isPending ? (
                <Loading label="팀원 권한 확인 중…" />
              ) : userId && membership.data ? (
                <TeamPanel projectId={id} userId={userId} isOwner={membership.data === 'owner'} />
              ) : (
                <Notice>팀원에게만 팀원 목록이 공개됩니다.</Notice>
              )
            ) : (
              <section className="panel flow project-description">
                <h2>프로젝트 소개</h2>
                <p className="preserve-text">{project.data.description}</p>
                <div className="project-details">
                  <div>
                    <CalendarDays size={18} aria-hidden="true" />
                    <strong>프로젝트 기간</strong>
                    <p>
                      {formatDate(project.data.start_date)} ~ {formatDate(project.data.due_date)}
                    </p>
                  </div>
                  <div>
                    <LockKeyhole size={18} aria-hidden="true" />
                    <strong>공개 범위</strong>
                    <p>{project.data.visibility === 'private' ? '팀원만 보기' : '전체 공개'}</p>
                  </div>
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </main>
  )
}
