import { describe, it, expect } from 'vitest'
import { collaborationMetrics, type MetricTask } from '../../src/features/team/metrics'

const tasks: MetricTask[] = [
  { status: 'done', weight: 6, due_date: '2026-11-01', last_status_at: '2026-11-01T12:00:00Z', assignees: ['a'] },
  { status: 'doing', weight: 3, due_date: '2026-11-20', last_status_at: '2026-11-08T12:00:00Z', assignees: ['a','b'] },
  { status: 'todo', weight: 1, due_date: '2026-11-25', last_status_at: '2026-11-22T12:00:00Z', assignees: ['a'] },
]
const now = new Date('2026-11-23T12:00:00Z')
describe('협업 지표', () => {
  it('완료 가중치로 진행률을 계산한다', () => expect(collaborationMetrics(tasks, ['a','b'], now).progress).toBe(60))
  it('완료 업무를 제외하고 마감 초과, 임박, 정체를 분리한다', () => {
    const result = collaborationMetrics(tasks, ['a','b'], now)
    expect(result.overdue).toHaveLength(1)
    expect(result.soon).toHaveLength(1)
    expect(result.stalled).toHaveLength(1)
  })
  it('공동 작업 가중치를 나눠 계산하며 완료건을 제외한다', () => {
    expect(collaborationMetrics(tasks, ['a','b'], now).loads).toEqual([{userId:'a',weight:2.5},{userId:'b',weight:1.5}])
  })
  it('업무가 없는 팀원을 포함하며 티켓 한 장만으로 편중을 판정하지 않는다', () => {
    const first = collaborationMetrics([tasks[2]], ['a','b'], now)
    expect(first.loads).toEqual([{userId:'a',weight:1},{userId:'b',weight:0}])
    expect(first.uneven).toBe(false)
    expect(collaborationMetrics([], [], now).progress).toBe(0)
  })
})
