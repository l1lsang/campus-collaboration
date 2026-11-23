import { useMutation, useQueryClient } from '@tanstack/react-query'
import { userError } from '../../lib/supabase/errors'
import { campusRpc } from '../../lib/supabase/rpc'
import type { Json } from '../../lib/supabase/database.types'
import type { MetricTask } from './metrics'

export type TeamMember = {
  membership_id: string
  nickname: string | null
  membership_role: 'owner' | 'member'
  role_name: string | null
}

export type TeamTask = MetricTask & { id: string; title: string; description: string }
export type FeedbackRound = {
  id: string
  title: string
  closes_at: string
  closed: boolean
  submitted: boolean
  summary: { coordination_average: number; communication_average: number } | null
}
export type TeamCheckin = {
  week_start: string
  submitted: boolean
  summary: { workload_average: number; capacity_average: number; needs_help: boolean } | null
}
export type TeamWorkbench = {
  project_title: string
  my_membership_id: string
  is_owner: boolean
  members: TeamMember[]
  tasks: TeamTask[]
  feedback: FeedbackRound[]
  checkin: TeamCheckin
}

type TeamAction =
  | 'team_assign_role'
  | 'team_create_task'
  | 'team_set_task_assignees'
  | 'team_set_task_status'
  | 'team_open_feedback'
  | 'team_close_feedback'
  | 'team_submit_feedback'
  | 'team_submit_checkin'

export type TeamScope = { projectId: string; userId: string }
export const workbenchKey = ({ projectId, userId }: TeamScope) => ['team-workbench', projectId, userId]
export const fetchWorkbench = (projectId: string) =>
  campusRpc<TeamWorkbench>('team_workbench', { p_project_id: projectId })

const messages: Record<string, string> = {
  PROJECT_MEMBER_REQUIRED: '프로젝트 팀원만 팀플로그에 접근할 수 있습니다.',
  PROJECT_OWNER_REQUIRED: '팀장만 이 작업을 할 수 있습니다.',
  TEAM_TASK_ASSIGNEE_REQUIRED: '팀장 또는 담당자만 작업 상태를 바꿀 수 있습니다.',
  TEAM_INVALID_ASSIGNEES: '현재 프로젝트에 속한 팀원만 담당자로 지정할 수 있습니다.',
  TEAM_INVALID_MEMBER: '현재 팀원 목록을 다시 확인해 주세요.',
  TEAM_INVALID_ROLE: '역할은 60자 이하로 입력해 주세요.',
  TEAM_INVALID_TASK: '작업 제목과 가중치, 마감일을 확인해 주세요.',
  TEAM_INVALID_STATUS: '올바른 작업 상태를 선택해 주세요.',
  TEAM_INVALID_FEEDBACK_ROUND: '회차 제목과 현재 시각 이후의 마감을 입력해 주세요.',
  TEAM_FEEDBACK_CLOSED: '종료된 회차에는 피드백을 제출할 수 없습니다.',
  TEAM_FEEDBACK_ALREADY_SUBMITTED: '이 회차에는 이미 피드백을 제출했습니다.',
  TEAM_CHECKIN_ALREADY_SUBMITTED: '이번 주에는 이미 체크인을 제출했습니다.',
  TEAM_INVALID_SCORE: '점수는 1~5 중에서 선택해 주세요.',
  TEAM_INVALID_COMMENT: '비공개 의견은 1,000자 이하로 입력해 주세요.',
}

export function teamError(error: unknown, fallback: string) {
  const reason = typeof error === 'object' && error !== null && 'message' in error ? error.message : null
  return typeof reason === 'string' && Object.hasOwn(messages, reason)
    ? messages[reason]
    : userError(error, fallback)
}

export function useTeamWrite(scope: TeamScope, action: TeamAction) {
  const cache = useQueryClient()
  const queryKey = workbenchKey(scope)
  const refresh = () => cache.invalidateQueries({ queryKey })
  return useMutation({
    mutationFn: (args: Record<string, Json>) => campusRpc<unknown>(action, args),
    onSuccess: refresh,
    onError: (error) => {
      const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null
      if (message === 'TEAM_FEEDBACK_CLOSED' || message === 'TEAM_FEEDBACK_ALREADY_SUBMITTED' || message === 'TEAM_CHECKIN_ALREADY_SUBMITTED') {
        return refresh()
      }
    },
    gcTime: 0,
    networkMode: 'always',
  })
}
