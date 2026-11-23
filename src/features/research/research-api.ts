import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { campusRpc } from '../../lib/supabase/rpc'
import { userError } from '../../lib/supabase/errors'

type TestStatus = 'open' | 'closed'
type EntryStatus = 'applied' | 'submitted' | 'confirmed' | 'rejected'
export type ResearchKind = 'project_test' | 'survey'
export type ResearchPath = '/research' | '/research/new' | '/research/mine' | '/research/credits'

export type ResearchTest = {
  id: string
  title: string
  description: string
  capacity: number
  slots_left: number
  reward: number
  kind: ResearchKind
}

export type ResearchWork = {
  organized: (Pick<ResearchTest, 'id' | 'title' | 'capacity' | 'slots_left' | 'reward' | 'kind'> & {
    status: TestStatus
    reserved_remaining: number
    participants: {
      id: string
      nickname: string | null
      feedback: string | null
      confirmation_code: string | null
      status: EntryStatus
    }[]
  })[]
  participating: {
    id: string
    test_id: string
    title: string
    description: string
    reward: number
    kind: ResearchKind
    test_status: TestStatus
    test_url: string | null
    confirmation_code: string | null
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
  title: string
  description: string
  testUrl: string
  capacity: number
  reward: number
} & ({ kind: 'project_test'; projectId: string } | { kind: 'survey'; projectId: string | null })

export const publishResearchRecruitment = (input: PublishInput) =>
  campusRpc<string>(input.kind === 'survey' ? 'publish_research_survey' : 'publish_research_test', {
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
export const submitSurveyCompletion = (id: string) =>
  campusRpc<null>('submit_research_survey_completion', { p_test_id: id })
export const confirmResearchParticipation = (id: string) =>
  campusRpc<null>('confirm_research_participation', { p_participation_id: id })
export const rejectSurveyCompletion = (id: string) =>
  campusRpc<null>('reject_research_survey_completion', { p_participation_id: id })
export const closeResearchTest = (id: string) =>
  campusRpc<null>('close_research_test', { p_test_id: id })

const researchMessages: Record<string, string> = {
  RESEARCH_PROJECT_OWNER_REQUIRED: '본인이 소유한 프로젝트에서만 모집할 수 있습니다.',
  RESEARCH_INVALID_DETAILS: '제목, 소개, HTTPS 링크, 인원과 보상을 확인해 주세요.',
  RESEARCH_REQUEST_CONFLICT:
    '같은 게시 요청으로 다른 내용이 전송되었습니다. 내 리서치를 확인해 주세요.',
  RESEARCH_INSUFFICIENT_CREDITS: '사용 가능한 크레딧이 부족합니다. 인원이나 보상을 줄여 주세요.',
  RESEARCH_TEST_UNAVAILABLE: '종료되었거나 접근할 수 없는 모집입니다.',
  RESEARCH_OWN_TEST: '본인이 진행하는 모집에는 신청할 수 없습니다.',
  RESEARCH_ALREADY_APPLIED: '이미 이 모집에 신청했습니다.',
  RESEARCH_TEST_FULL: '모집 인원이 모두 찼습니다.',
  RESEARCH_WRONG_KIND: '이 모집 유형에는 해당 작업을 할 수 없습니다.',
  RESEARCH_INVALID_FEEDBACK: '피드백을 10~3,000자로 작성해 주세요.',
  RESEARCH_APPLICATION_REQUIRED: '신청한 모집에서만 참여 완료를 제출할 수 있습니다.',
  RESEARCH_FEEDBACK_ALREADY_SUBMITTED: '이미 이 테스트에 피드백을 제출했습니다.',
  RESEARCH_FEEDBACK_REQUIRED:
    '피드백을 제출했거나 설문 응답 완료를 알린 참여자에게만 보상할 수 있습니다.',
  RESEARCH_PENDING_FEEDBACK:
    '확인 대기 중인 참여가 있습니다. 먼저 보상을 지급하거나 설문 신고를 거절해 주세요.',
  RESEARCH_SURVEY_COMPLETION_REQUIRED: '응답 완료를 신고한 참여만 거절할 수 있습니다.',
  RESEARCH_PARTICIPATION_ALREADY_CONFIRMED: '이미 보상이 지급된 참여는 거절할 수 없습니다.',
  RESEARCH_PARTICIPATION_REJECTED: '이미 응답 완료가 거절된 참여입니다.',
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
  const url = value?.replace(/^ +| +$/g, '')
  if (!url || Array.from(url).length > 2000 || url.includes('\\') || /[\s\p{Cc}]/u.test(url))
    return null
  // Reject ambiguous authority syntax before the browser can normalize it.
  const match = /^https:\/\/([^:/?#%@[\]]+)(?::([0-9]{1,5}))?(?:[/?#]|$)/i.exec(url)
  if (!match) return null
  const [, rawHost, port] = match
  if (Number(port ?? 0) > 65535) return null

  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return null
  }

  // Match SQL's ASCII DNS contract after IDNA normalization, including the IP/localhost blocks.
  const dns = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
  if (
    hostname.length > 253 ||
    !dns.test(hostname) ||
    /(?:^|\.)xn--[a-z0-9](?:\.|$)|\.(?:localhost|[0-9]+|0x[0-9a-f]*)$/i.test(hostname)
  )
    return null

  // Preserve existing ASCII URLs and idempotency payloads. Only replace a Unicode hostname.
  if (/^[\x20-\x7e]+$/.test(rawHost)) return rawHost.toLowerCase() === hostname ? url : null
  const normalized = `${url.slice(0, 8)}${hostname}${url.slice(8 + rawHost.length)}`
  return Array.from(normalized).length <= 2000 ? normalized : null
}
