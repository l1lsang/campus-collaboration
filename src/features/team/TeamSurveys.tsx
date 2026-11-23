import { Button } from '../../components/ui/button'
import { Field, Notice } from '../../components/common/states'
import { type FeedbackRound, type TeamCheckin, type TeamScope, teamError, useTeamWrite } from './team-api'

const deadlineFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })
const formatScore = (value: number) => value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function Score({ id, name, label, low, high }: { id: string; name: string; label: string; low: string; high: string }) {
  return (
    <Field id={id} label={label}>
      <select className="input" id={id} name={name} defaultValue={3}>
        <option value={1}>1 · {low}</option>
        <option value={2}>2</option>
        <option value={3}>3 · 보통</option>
        <option value={4}>4</option>
        <option value={5}>5 · {high}</option>
      </select>
    </Field>
  )
}

function OpenRound({ scope }: { scope: TeamScope }) {
  const mutation = useTeamWrite(scope, 'team_open_feedback')
  return (
    <form className="flow" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget
      const values = new FormData(form)
      mutation.mutate({ p_project_id: scope.projectId, p_title: String(values.get('title') ?? '').trim(),
        p_closes_at: `${String(values.get('closesAt'))}:00+09:00` }, { onSuccess: () => form.reset() })
    }}>
      <div className="form-grid">
        <Field id="team-round-title" label="피드백 회차 제목">
          <input id="team-round-title" className="input" name="title" maxLength={100} placeholder="예: 중간 회고" required />
        </Field>
        <Field id="team-round-deadline" label="응답 마감 (한국 시간)">
          <input id="team-round-deadline" className="input" name="closesAt" type="datetime-local" required />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={mutation.isPending}>피드백 회차 열기</Button>
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '피드백 회차를 열지 못했습니다.')}</Notice>}
    </form>
  )
}

function FeedbackForm({ scope, round }: { scope: TeamScope; round: FeedbackRound }) {
  const mutation = useTeamWrite(scope, 'team_submit_feedback')
  return (
    <form className="flow" onSubmit={(event) => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      mutation.mutate({ p_round_id: round.id, p_coordination: Number(values.get('coordination')),
        p_communication: Number(values.get('communication')), p_comment: String(values.get('comment') ?? '').trim() || null })
    }}>
      <div className="form-grid">
        <Score id={`team-coordination-${round.id}`} name="coordination" label="일정·업무 조율" low="어려웠어요" high="원활했어요" />
        <Score id={`team-communication-${round.id}`} name="communication" label="팀 내 소통" low="어려웠어요" high="원활했어요" />
      </div>
      <Field id={`team-comment-${round.id}`} label="비공개 의견 (선택)">
        <textarea id={`team-comment-${round.id}`} className="input" name="comment" maxLength={1000} />
      </Field>
      <Button type="submit" disabled={mutation.isPending}>피드백 제출</Button>
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '피드백을 제출하지 못했습니다.')}</Notice>}
    </form>
  )
}

function FeedbackCard({ scope, round, isOwner }: { scope: TeamScope; round: FeedbackRound; isOwner: boolean }) {
  const close = useTeamWrite(scope, 'team_close_feedback')
  const summary = round.closed ? round.summary : null
  return (
    <article className="team-task flow">
      <div className="split-row">
        <h3>{round.title}</h3>
        <span className="chip">{round.closed ? '종료' : '응답 받는 중'}</span>
      </div>
      <p className="field-hint">{round.closed ? '종료' : '마감'} {deadlineFormat.format(new Date(round.closes_at))} (한국 시간)</p>
      {round.submitted && <p>내 피드백을 제출했어요.</p>}
      {!round.closed && !round.submitted && <FeedbackForm scope={scope} round={round} />}
      {round.closed && (summary
        ? <p>조율 평균 {formatScore(summary.coordination_average)} / 5 · 소통 평균 {formatScore(summary.communication_average)} / 5</p>
        : <p className="muted">응답자가 3명 미만이어서 결과를 공개하지 않습니다.</p>)}
      {!round.closed && isOwner && (
        <>
          <p className="field-hint">지금 종료하면 추가 응답을 받을 수 없습니다.</p>
          <Button type="button" variant="outline" disabled={close.isPending} onClick={() => close.mutate({ p_round_id: round.id })}>응답 종료</Button>
          {close.error && <Notice kind="error">{teamError(close.error, '피드백 회차를 종료하지 못했습니다.')}</Notice>}
        </>
      )}
    </article>
  )
}

export function TeamFeedback({ scope, feedback, isOwner }: { scope: TeamScope; feedback: FeedbackRound[]; isOwner: boolean }) {
  return (
    <section className="panel flow" aria-labelledby="team-feedback">
      <h2 id="team-feedback">동료 피드백</h2>
      <p className="muted">종료된 회차에 3명 이상 응답한 경우에만 팀 평균을 공개합니다. 작성자, 개별 점수, 의견 원문은 팀이나 보고서에 공개되지 않습니다.</p>
      {isOwner && <OpenRound scope={scope} />}
      {feedback.length ? feedback.map((round) => <FeedbackCard key={round.id} scope={scope} round={round} isOwner={isOwner} />)
        : <p className="muted">아직 피드백 회차가 없습니다.</p>}
    </section>
  )
}

function CheckinForm({ scope }: { scope: TeamScope }) {
  const mutation = useTeamWrite(scope, 'team_submit_checkin')
  return (
    <form className="flow" onSubmit={(event) => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      mutation.mutate({ p_project_id: scope.projectId, p_workload: Number(values.get('workload')),
        p_capacity: Number(values.get('capacity')), p_needs_help: values.has('needsHelp') })
    }}>
      <div className="form-grid">
        <Score id="team-workload" name="workload" label="현재 체감 업무량" low="낮아요" high="높아요" />
        <Score id="team-capacity" name="capacity" label="이번 주 추가 업무 여유" low="없어요" high="많아요" />
      </div>
      <label className="team-choice"><input name="needsHelp" type="checkbox" />팀 차원의 도움이 필요해요</label>
      <Button type="submit" disabled={mutation.isPending}>체크인 제출</Button>
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '체크인을 제출하지 못했습니다.')}</Notice>}
    </form>
  )
}

export function TeamCheckinPanel({ scope, checkin }: { scope: TeamScope; checkin: TeamCheckin }) {
  return (
    <section className="panel flow" aria-labelledby="team-checkin">
      <h2 id="team-checkin">업무량 체크인</h2>
      <p className="muted">매주 월요일(한국 시간)부터 한 번 제출할 수 있습니다. 지난주에 3명 이상 응답한 경우에만 팀 평균을 공개합니다.</p>
      <p className="field-hint">이번 주 시작: {checkin.week_start}</p>
      {checkin.submitted ? <p>이번 주 체크인을 제출했어요.</p> : <CheckinForm scope={scope} />}
      <h3>지난주 팀 평균</h3>
      {checkin.summary ? (
        <>
          <p>체감 업무량 {formatScore(checkin.summary.workload_average)} / 5 · 추가 업무 여유 {formatScore(checkin.summary.capacity_average)} / 5</p>
          {checkin.summary.needs_help && <Notice>팀 차원에서 업무 분담이나 일정을 조정할 필요가 있는지 확인해 보세요.</Notice>}
        </>
      ) : <p className="muted">공개할 수 있는 지난주 집계가 없습니다.</p>}
    </section>
  )
}
