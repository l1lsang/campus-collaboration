export type MetricTask = {
  status: 'todo' | 'doing' | 'review' | 'done' | 'blocked'
  weight: number
  due_date: string | null
  last_status_at: string
  assignees: string[]
}

const dateInSeoul = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)
const dayMs = 86_400_000

export function collaborationMetrics<T extends MetricTask>(tasks: T[], userIds: string[], now: Date) {
  const today = dateInSeoul(now)
  const soon = dateInSeoul(new Date(now.getTime() + 3 * dayMs))
  const active = tasks.filter((task) => task.status !== 'done')
  const total = tasks.reduce((sum, task) => sum + task.weight, 0)
  const done = total - active.reduce((sum, task) => sum + task.weight, 0)
  const workloads = new Map(userIds.map((id) => [id, 0]))
  for (const task of active) {
    const assignees = [...new Set(task.assignees)].filter((id) => workloads.has(id))
    for (const id of assignees) workloads.set(id,(workloads.get(id) ?? 0) + task.weight / assignees.length)
  }
  const loads = [...workloads].map(([userId, weight]) => ({ userId, weight }))
  const values = loads.map(({weight}) => weight)
  return {
    progress: total ? Math.round(done / total * 100) : 0, total, done, loads,
    overdue: active.filter((t) => t.due_date && t.due_date < today),
    soon: active.filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon),
    stalled: active.filter((t) => t.status !== 'todo' && now.getTime() - Date.parse(t.last_status_at) >= 7 * dayMs),
    uneven: active.length >= 3 && values.length >= 2 && Math.max(...values) >= 4 && Math.max(...values) >= Math.min(...values) * 2,
  }
}
