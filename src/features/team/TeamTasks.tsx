import { Button } from '../../components/ui/button'
import { Field, Notice } from '../../components/common/states'
import { type TeamMember, type TeamScope, type TeamTask, type TeamWorkbench, teamError, useTeamWrite } from './team-api'

const statusLabels = {
  todo: '할 일',
  doing: '진행 중',
  review: '검토 중',
  done: '완료',
  blocked: '막힘',
} satisfies Record<TeamTask['status'], string>
const statuses = Object.keys(statusLabels) as TeamTask['status'][]
export const memberName = (member: TeamMember) => member.nickname ?? '닉네임 없음'

export function TeamRoles({ data, scope }: { data: TeamWorkbench; scope: TeamScope }) {
  return (
    <section className="panel flow" aria-labelledby="team-roles">
      <h2 id="team-roles">역할 분담</h2>
      <p className="muted">{data.is_owner ? '역할을 비워서 저장하면 배정을 해제할 수 있습니다.' : '팀장이 지정한 역할입니다.'}</p>
      <ul className="divided-list">
        {data.members.map((member) => (
          <li className="team-role-row" key={member.membership_id}>
            <p><strong>{memberName(member)}</strong> <span className="chip">{member.membership_role === 'owner' ? '팀장' : '팀원'}</span></p>
            {data.is_owner ? (
              <RoleForm key={member.role_name ?? ''} member={member} scope={scope} />
            ) : <p>{member.role_name ?? '역할 미지정'}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RoleForm({ member, scope }: { member: TeamMember; scope: TeamScope }) {
  const mutation = useTeamWrite(scope, 'team_assign_role')
  const id = `team-role-${member.membership_id}`
  const label = `${memberName(member)} 역할`
  return (
    <form className="flow" onSubmit={(event) => {
      event.preventDefault()
      mutation.mutate({ p_project_id: scope.projectId, p_membership_id: member.membership_id,
        p_role_name: String(new FormData(event.currentTarget).get('role') ?? '').trim() || null })
    }}>
      <div className="team-inline-form">
        <Field id={id} label={label}>
          <input id={id} name="role" className="input" defaultValue={member.role_name ?? ''} maxLength={60} placeholder="예: 디자인" />
        </Field>
        <Button type="submit" variant="outline" aria-label={`${label} 저장`} disabled={mutation.isPending}>저장</Button>
      </div>
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '역할을 저장하지 못했습니다.')}</Notice>}
    </form>
  )
}

function AssigneeChoices({ members, selected, legend }: { members: TeamMember[]; selected: string[]; legend: string }) {
  return (
    <fieldset className="team-choices">
      <legend>{legend}</legend>
      <div className="team-checkboxes">
        {members.map((member) => (
          <label key={member.membership_id}>
            <input type="checkbox" name="assignees" value={member.membership_id} defaultChecked={selected.includes(member.membership_id)} />
            {memberName(member)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function NewTaskForm({ scope, members }: { scope: TeamScope; members: TeamMember[] }) {
  const mutation = useTeamWrite(scope, 'team_create_task')
  return (
    <form className="panel flow" aria-labelledby="team-new-task" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget
      const values = new FormData(form)
      mutation.mutate({
        p_project_id: scope.projectId, p_title: String(values.get('title') ?? '').trim(),
        p_description: String(values.get('description') ?? '').trim(), p_weight: Number(values.get('weight')),
        p_due_date: String(values.get('dueDate') ?? '') || null, p_assignees: values.getAll('assignees').map(String),
      }, { onSuccess: () => form.reset() })
    }}>
      <h3 id="team-new-task">새 작업</h3>
      <Field id="team-task-title" label="작업 제목">
        <input id="team-task-title" className="input" name="title" required maxLength={120} />
      </Field>
      <Field id="team-task-description" label="작업 설명 (선택)">
        <textarea id="team-task-description" className="input" name="description" maxLength={2000} />
      </Field>
      <div className="form-grid">
        <Field id="team-task-weight" label="가중치 (1~10)">
          <input id="team-task-weight" className="input" name="weight" type="number" required min={1} max={10} defaultValue={1} />
        </Field>
        <Field id="team-task-due" label="마감일 (선택)">
          <input id="team-task-due" className="input" name="dueDate" type="date" />
        </Field>
      </div>
      <AssigneeChoices members={members} selected={[]} legend="새 작업 담당자 (선택)" />
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '작업을 등록하지 못했습니다.')}</Notice>}
      <Button type="submit" disabled={mutation.isPending}>작업 등록</Button>
    </form>
  )
}

function TaskAssigneesForm({ task, scope, members }: { task: TeamTask; scope: TeamScope; members: TeamMember[] }) {
  const mutation = useTeamWrite(scope, 'team_set_task_assignees')
  return (
    <form className="flow" onSubmit={(event) => {
      event.preventDefault()
      mutation.mutate({ p_task_id: task.id, p_assignees: new FormData(event.currentTarget).getAll('assignees').map(String) })
    }}>
      <AssigneeChoices members={members} selected={task.assignees} legend={`${task.title} 담당자`} />
      <Button type="submit" variant="outline" aria-label={`${task.title} 담당자 저장`} disabled={mutation.isPending}>담당자 저장</Button>
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '담당자를 저장하지 못했습니다.')}</Notice>}
    </form>
  )
}

function TaskCard({ task, data, scope }: { task: TeamTask; data: TeamWorkbench; scope: TeamScope }) {
  const mutation = useTeamWrite(scope, 'team_set_task_status')
  const assignees = data.members.filter((member) => task.assignees.includes(member.membership_id)).map(memberName)
  const canMove = data.is_owner || task.assignees.includes(data.my_membership_id)
  const statusId = `team-task-status-${task.id}`
  return (
    <article className="team-task flow">
      <h4>{task.title}</h4>
      {task.description && <p className="preserve-text">{task.description}</p>}
      <p className="field-hint">가중치 {task.weight} · {task.due_date ? `마감 ${task.due_date}` : '마감 미정'}</p>
      <p className="field-hint">담당자: {assignees.join(', ') || '미지정'}</p>
      {canMove && <Field id={statusId} label={`${task.title} 상태`}>
        <select id={statusId} className="input" value={task.status} disabled={mutation.isPending} onChange={(event) => {
          mutation.mutate({ p_task_id: task.id, p_status: event.currentTarget.value })
        }}>
          {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
        </select>
      </Field>}
      {mutation.error && <Notice kind="error">{teamError(mutation.error, '상태를 변경하지 못했습니다.')}</Notice>}
      {data.is_owner && <TaskAssigneesForm key={task.assignees.join(',')} task={task} scope={scope} members={data.members} />}
    </article>
  )
}

export function TeamTasks({ data, scope }: { data: TeamWorkbench; scope: TeamScope }) {
  return (
    <section className="flow" aria-labelledby="team-tasks">
      <h2 id="team-tasks">작업 보드</h2>
      <p className="muted">팀장은 작업과 담당자를 지정하고, 팀장 또는 담당자는 상태를 변경할 수 있습니다.</p>
      {data.is_owner && <NewTaskForm scope={scope} members={data.members} />}
      {!data.tasks.length ? <p className="muted">아직 등록된 작업이 없습니다.</p> : (
        <div className="team-board">
          {statuses.map((status) => {
            const tasks = data.tasks.filter((task) => task.status === status)
            return (
              <section className="panel flow team-column" aria-labelledby={`team-column-${status}`} key={status}>
                <h3 id={`team-column-${status}`}>{statusLabels[status]} <span className="chip">{tasks.length}</span></h3>
                {tasks.map((task) => <TaskCard key={task.id} task={task} data={data} scope={scope} />)}
                {!tasks.length && <p className="muted">작업 없음</p>}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
