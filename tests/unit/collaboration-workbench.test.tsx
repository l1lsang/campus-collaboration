import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { TeamWorkbenchPage } from '../../src/features/team/TeamWorkbenchPage'
import { campusRpc } from '../../src/lib/supabase/rpc'

vi.mock('../../src/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: { user: { id: 'signed-in-user' } }, loading: false }),
}))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: vi.fn() }))

const rpc = vi.mocked(campusRpc)
const projectId = '61000000-0000-4000-8000-000000000021'
const base = {
  project_title: '지도 프로젝트', is_owner: false, my_membership_id: 'member',
  members: [
    { membership_id: 'owner', nickname: '민서', membership_role: 'owner', role_name: null },
    { membership_id: 'member', nickname: '지민', membership_role: 'member', role_name: '디자인' },
  ],
  tasks: [{
    id: 'task', title: '지도 만들기', description: '', status: 'todo', weight: 4,
    due_date: null, last_status_at: '2026-11-23T12:00:00Z', assignees: ['member'],
  }],
  feedback: [{ id: 'round', title: '중간 점검', closes_at: '2035-11-24T08:00:00Z', closed: false, submitted: false, summary: null }],
  checkin: { week_start: '2026-11-23', submitted: false, summary: null },
}

beforeEach(() => {
  rpc.mockReset()
})

function page() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/projects/${projectId}/team`]}>
      <Routes><Route path="/projects/:id/team" element={<TeamWorkbenchPage />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>)
  return userEvent.setup()
}

it('담당자가 상태를 바꾸면 재조회 결과로 진행률을 표시한다', async () => {
  let completed = false
  rpc.mockImplementation(async (name) => {
    if (name === 'team_set_task_status') { completed = true; return null }
    if (name === 'team_workbench') return { ...base, tasks: base.tasks.map((task) => ({ ...task, status: completed ? 'done' : 'todo' })) }
    throw new Error(`unexpected rpc: ${name}`)
  })
  page()
  expect(await screen.findByRole('heading', { name: '지도 프로젝트' })).toBeInTheDocument()
  const metrics = screen.getByRole('region', { name: '협업 지표' })
  expect(within(metrics).getByText('0%')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '작업 등록' })).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('지도 만들기 상태'), { target: { value: 'done' } })
  expect(await within(metrics).findByText('100%')).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith('team_set_task_status', { p_task_id: 'task', p_status: 'done' })
})

it('팀장이 역할과 작업 담당자를 저장할 수 있다', async () => {
  rpc.mockImplementation(async (name) => {
    if (name === 'team_workbench') return { ...base, is_owner: true, my_membership_id: 'owner' }
    if (['team_assign_role', 'team_set_task_assignees', 'team_create_task'].includes(name)) return null
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page()
  const role = await screen.findByLabelText('지민 역할')
  await user.clear(role)
  await user.type(role, '개발')
  await user.click(screen.getByRole('button', { name: '지민 역할 저장' }))
  expect(rpc).toHaveBeenCalledWith('team_assign_role', { p_project_id: projectId, p_membership_id: 'member', p_role_name: '개발' })
  const assignees = screen.getByRole('group', { name: '지도 만들기 담당자' })
  await user.click(within(assignees).getByLabelText('민서'))
  await user.click(screen.getByRole('button', { name: '지도 만들기 담당자 저장' }))
  expect(rpc).toHaveBeenCalledWith('team_set_task_assignees', { p_task_id: 'task', p_assignees: ['owner', 'member'] })
  await user.type(screen.getByLabelText('작업 제목'), '새 지도 작업')
  await user.click(screen.getByRole('button', { name: '작업 등록' }))
  expect(rpc).toHaveBeenCalledWith('team_create_task', { p_project_id: projectId, p_title: '새 지도 작업', p_description: '', p_weight: 1, p_due_date: null, p_assignees: [] })
})

it('비공개 응답 실패 시 입력을 유지하고 성공 시 내 제출만 표시한다', async () => {
  let submitted = false
  let checkedIn = false
  let fail = true
  rpc.mockImplementation(async (name) => {
    if (name === 'team_submit_feedback') { if (fail) throw new Error('network'); submitted = true; return null }
    if (name === 'team_submit_checkin') { checkedIn = true; return null }
    if (name === 'team_workbench') return { ...base, feedback: base.feedback.map((round) => ({ ...round, submitted })), checkin: { ...base.checkin, submitted: checkedIn } }
    throw new Error(`unexpected rpc: ${name}`)
  })
  const user = page()
  const feedback = await screen.findByRole('region', { name: '동료 피드백' })
  const comment = within(feedback).getByLabelText('비공개 의견 (선택)')
  await user.type(comment, '공개하면 안 되는 의견')
  await user.click(within(feedback).getByRole('button', { name: '피드백 제출' }))
  expect(await within(feedback).findByRole('alert')).toHaveTextContent('피드백을 제출하지 못했습니다')
  expect(comment).toHaveValue('공개하면 안 되는 의견')
  fail = false
  await user.click(within(feedback).getByRole('button', { name: '피드백 제출' }))
  expect(await within(feedback).findByText('내 피드백을 제출했어요.')).toBeInTheDocument()
  expect(within(feedback).queryByText('공개하면 안 되는 의견')).not.toBeInTheDocument()
  const checkin = screen.getByRole('region', { name: '업무량 체크인' })
  await user.click(within(checkin).getByLabelText('팀 차원의 도움이 필요해요'))
  await user.click(within(checkin).getByRole('button', { name: '체크인 제출' }))
  expect(rpc).toHaveBeenCalledWith('team_submit_checkin', { p_project_id: projectId, p_workload: 3, p_capacity: 3, p_needs_help: true })
  expect(await within(checkin).findByText('이번 주 체크인을 제출했어요.')).toBeInTheDocument()
})
