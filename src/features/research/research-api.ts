import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { campusRpc } from '../../lib/supabase/rpc'
import { userError } from '../../lib/supabase/errors'

type TestStatus = 'open' | 'closed'
type EntryStatus = 'applied' | 'submitted' | 'confirmed'

export type ResearchTest = {
  id: string
  title: string
  description: string
  capacity: number
  slots_left: number
  reward: number
}

export type ResearchWork = {
  organized: (Pick<ResearchTest, 'id' | 'title' | 'capacity' | 'slots_left' | 'reward'> & {
    status: TestStatus
    reserved_remaining: number
    participants: {
      id: string
      nickname: string | null
      feedback: string | null
      status: EntryStatus
    }[]
  })[]
  participating: {
    id: string
    test_id: string
    title: string
    description: string
    reward: number
    test_status: TestStatus
    test_url: string | null
    status: EntryStatus
  }[]
}

export type CreditLedger = {
  available: number
  reserved: number
  next_before: string | null
  entries: {
    sequence: string
    kind: 'starter' | 'reserve' | 'release' | 'spend' | 'award'
    available_delta: number
    reserved_delta: number
    created_at: string
    test_title: string | null
  }[]
}

const publicKey = ['public', 'research'] as const
const accountKey = (id: string) => ['account', id, 'research'] as const

export function useResearchTests() {
  return useQuery({
    queryKey: publicKey,
    queryFn: () => campusRpc<ResearchTest[]>('list_research_tests'),
  })
}

export function useResearchWork(userId: string | undefined) {
  return useQuery({
    queryKey: [...accountKey(userId ?? 'guest'), 'work'],
    enabled: Boolean(userId),
    queryFn: () => campusRpc<ResearchWork>('my_research_work'),
  })
}

export function useResearchCredits(userId: string, before?: string) {
  return useQuery({
    queryKey: [...accountKey(userId), 'credits', before ?? null],
    queryFn: () =>
      campusRpc<CreditLedger>(
        'my_research_credits',
        before ? { p_before_sequence: before } : undefined,
      ),
  })
}

export function useResearchMutation<TVariables, TData>(
  userId: string,
  mutationFn: (values: TVariables) => Promise<TData>,
) {
  const cache = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: publicKey }),
        cache.invalidateQueries({ queryKey: accountKey(userId) }),
      ])
    },
  })
}

type PublishInput = {
  requestId: string
  projectId: string
  title: string
  description: string
  testUrl: string
  capacity: number
  reward: number
}

export const publishResearchTest = (input: PublishInput) =>
  campusRpc<string>('publish_research_test', {
    p_request_id: input.requestId,
    p_project_id: input.projectId,
    p_title: input.title,
    p_description: input.description,
    p_test_url: input.testUrl,
    p_capacity: input.capacity,
    p_reward: input.reward,
  })

export const applyResearchTest = (id: string) =>
  campusRpc<string>('apply_research_test', { p_test_id: id })
export const submitResearchFeedback = (input: { id: string; feedback: string }) =>
  campusRpc<null>('submit_research_feedback', { p_test_id: input.id, p_feedback: input.feedback })
export const confirmResearchParticipation = (id: string) =>
  campusRpc<null>('confirm_research_participation', { p_participation_id: id })
export const closeResearchTest = (id: string) =>
  campusRpc<null>('close_research_test', { p_test_id: id })

const researchMessages: Record<string, string> = {
  RESEARCH_PROJECT_OWNER_REQUIRED: '본인이 소유한 프로젝트에서만 모집할 수 있습니다.',
  RESEARCH_INVALID_DETAILS: '제목, 소개, HTTPS 링크, 인원과 보상을 확인해 주세요.',
  RESEARCH_REQUEST_CONFLICT:
    '같은 게시 요청으로 다른 내용이 전송되었습니다. 내 리서치를 확인해 주세요.',
  RESEARCH_INSUFFICIENT_CREDITS: '사용 가능한 크레딧이 부족합니다. 인원이나 보상을 줄여 주세요.',
  RESEARCH_TEST_UNAVAILABLE: '종료되었거나 접근할 수 없는 테스트입니다.',
  RESEARCH_OWN_TEST: '본인이 진행하는 테스트에는 신청할 수 없습니다.',
  RESEARCH_ALREADY_APPLIED: '이미 이 테스트에 신청했습니다.',
  RESEARCH_TEST_FULL: '모집 인원이 모두 찼습니다.',
  RESEARCH_INVALID_FEEDBACK: '피드백을 10~3,000자로 작성해 주세요.',
  RESEARCH_APPLICATION_REQUIRED: '신청한 테스트에만 피드백을 제출할 수 있습니다.',
  RESEARCH_FEEDBACK_ALREADY_SUBMITTED: '이미 이 테스트에 피드백을 제출했습니다.',
  RESEARCH_FEEDBACK_REQUIRED: '피드백을 제출한 참여자에게만 보상할 수 있습니다.',
  RESEARCH_PENDING_FEEDBACK: '확인하지 않은 피드백이 있습니다. 먼저 확인하고 보상을 지급해 주세요.',
}

export function researchError(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    Object.hasOwn(researchMessages, error.message)
  ) {
    return researchMessages[error.message]
  }
  return userError(error, fallback)
}

export function safeTestUrl(value: string | null) {
  if (!value || !/^https:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.')
      ? url.href
      : null
  } catch {
    return null
  }
}
