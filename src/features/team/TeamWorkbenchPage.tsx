import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { z } from 'zod'
import { Loading, Notice, PageHeading } from '../../components/common/states'
import { brand } from '../../lib/constants/brand'
import { useAuth } from '../auth/auth-provider'
import { collaborationMetrics } from './metrics'
import { fetchWorkbench, type TeamScope, type TeamTask, type TeamWorkbench, teamError, workbenchKey } from './team-api'
import { TeamCheckinPanel, TeamFeedback } from './TeamSurveys'
import { memberName, TeamRoles, TeamTasks } from './TeamTasks'
import './team.css'

export function TeamWorkbenchPage() {
  const { id } = useParams()
  const auth = useAuth()
  const userId = auth.session?.user.id
  return (
    <main className="container page team-workbench" id="main-content">
      {auth.loading ? <Loading label="팀원 권한 확인 중…" />
        : !id || !z.uuid().safeParse(id).success ? <Notice kind="error">유효한 프로젝트 주소가 아닙니다.</Notice>
          : !userId ? <Notice>팀플로그를 이용하려면 로그인해 주세요.</Notice>
            : <WorkbenchContent key={`${userId}:${id}`} scope={{ projectId: id, userId }} />}
    </main>
  )
}

function WorkbenchContent({ scope }: { scope: TeamScope }) {
  const query = useQuery({
    queryKey: workbenchKey(scope),
    queryFn: () => fetchWorkbench(scope.projectId),
    retry: false,
    gcTime: 0,
    refetchInterval: 60_000,
  })
  const projectPath = `/projects/${scope.projectId}`
  return (
    <>
      <Link className="back-link" to={projectPath}>← 프로젝트 소개</Link>
      {query.isPending ? <Loading label="팀플로그를 불러오는 중…" />
        : query.isError ? (
          <Notice kind="error">
            {teamError(query.error, '팀플로그를 불러오지 못했습니다.')}{' '}
            <button type="button" className="text-link" onClick={() => void query.refetch()}>다시 시도</button>
          </Notice>
        ) : (
          <>
            <PageHeading label={brand.workspace} title={query.data.project_title} description="역할을 나누고 작업을 관리하며, 팀의 협업 상태를 살펴보세요." />
            <nav className="workspace-nav team-nav" aria-label="프로젝트 메뉴">
              <Link to={`${projectPath}/members`}>팀원 및 초대</Link>
            </nav>
            <div className="flow team-sections">
              <TeamMetrics data={query.data} />
              <TeamRoles data={query.data} scope={scope} />
              <TeamTasks data={query.data} scope={scope} />
              <TeamFeedback scope={scope} feedback={query.data.feedback} isOwner={query.data.is_owner} />
              <TeamCheckinPanel key={query.data.checkin.week_start} checkin={query.data.checkin} scope={scope} />
            </div>
          </>
        )}
    </>
  )
}

function TeamMetrics({ data }: { data: TeamWorkbench }) {
  const ids = data.members.map((member) => member.membership_id)
  const members = new Map(data.members.map((member) => [member.membership_id, memberName(member)]))
  const metrics = collaborationMetrics(data.tasks, ids, new Date())
  const signals: { label: string; tasks: TeamTask[] }[] = [
    { label: '마감 초과', tasks: metrics.overdue },
    { label: '3일 이내 마감', tasks: metrics.soon },
    { label: '7일 이상 상태 미변경', tasks: metrics.stalled },
  ]
  return (
    <section className="panel flow" aria-labelledby="team-metrics">
      <h2 id="team-metrics">협업 지표</h2>
      <p className="muted">작업 가중치와 상태를 바탕으로 일정과 업무 분담을 점검하는 참고 지표입니다. 개인 기여도나 평가 점수는 아닙니다.</p>
      <p>완료 진행률 <strong>{metrics.progress}%</strong> · 완료 가중치 {metrics.done} / 전체 {metrics.total}</p>
      <progress aria-label="완료 진행률" className="team-progress" max={100} value={metrics.progress} />
      <dl className="team-indicators">
        {signals.map(({ label, tasks }) => (
          <div className="team-task" key={label}>
            <dt>{label}</dt>
            <dd><strong>{tasks.length}건</strong></dd>
            {!!tasks.length && <dd><ul className="team-list">{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul></dd>}
          </div>
        ))}
      </dl>
      <div className="flow">
        <h3>미완료 작업의 배정 가중치</h3>
        <p className="field-hint">공동 작업의 가중치는 담당자 수로 나눕니다.</p>
        <ul className="divided-list">
          {metrics.loads.map(({ userId, weight }) => (
            <li className="split-row" key={userId}>
              <span>{members.get(userId)}</span>
              <span>{weight.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}</span>
            </li>
          ))}
        </ul>
        {metrics.uneven && <Notice>배정된 업무량에 차이가 있습니다. 팀과 업무 분담을 점검해 보세요.</Notice>}
      </div>
    </section>
  )
}
