import { userError } from '../../lib/supabase/errors'
import { campusRpc } from '../../lib/supabase/rpc'

export const opportunityLabels = {
  idea: '반쪽 아이디어',
  reboot: '프로젝트 리부트',
  contest: '공모전 팀 모집',
} as const
export const formatLabels = {
  online: '온라인',
  offline: '오프라인',
  hybrid: '온·오프라인 혼합',
} as const
export const statusLabels = { pending: '검토 중', accepted: '수락됨', rejected: '거절됨' } as const

export type OpportunityType = keyof typeof opportunityLabels
export type ContestFormat = keyof typeof formatLabels
export type RequestStatus = keyof typeof statusLabels
export type OpportunityFilters = Record<
  'university' | 'major' | 'skill' | 'role' | 'competition' | 'format',
  string
>
export type Opportunity = {
  id: string
  type: OpportunityType
  title: string
  description: string
  roles: string[]
  skills: string[]
  university_name: string | null
  major: string | null
  gap: string | null
  source_project_id: string | null
  competition: string | null
  format: ContestFormat | null
  deadline: string | null
  is_mine: boolean
  is_open: boolean
  request_status: RequestStatus | null
  project_id: string | null
}
export type MatchingRequest = {
  id: string
  opportunity_title: string
  type: OpportunityType
  message: string
  applicant_nickname: string | null
  selected_role: string | null
  timezone: string | null
  status: RequestStatus
  created_at: string
  project_id: string | null
}

export const matchingPageSize = 20
export const matchingKey = (userId: string) => ['account', userId, 'matching'] as const
export const emptyFilters: OpportunityFilters = {
  university: '',
  major: '',
  skill: '',
  role: '',
  competition: '',
  format: '',
}
const nullableText = (value: unknown) => (typeof value === 'string' ? value.trim() || null : null)
const read = (form: FormData, name: string) => nullableText(form.get(name))
const tags = (value: string | null) => [
  ...new Set(
    value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean) ?? [],
  ),
]

export function listOpportunities(
  type: OpportunityType | null,
  filters: OpportunityFilters,
  page: number,
  mine = false,
) {
  return campusRpc<Opportunity[]>('list_matching_opportunities', {
    p_type: type,
    p_mine: mine,
    p_university_id: nullableText(filters.university),
    p_major: nullableText(filters.major),
    p_skill: nullableText(filters.skill),
    p_role: nullableText(filters.role),
    p_competition: nullableText(filters.competition),
    p_format: nullableText(filters.format),
    p_offset: page * matchingPageSize,
  })
}

export function listRebootSources(search: string, page: number) {
  return campusRpc<{ id: string; title: string }[]>('list_matching_reboot_sources', {
    p_search: nullableText(search),
    p_offset: page * matchingPageSize,
  })
}

export async function createOpportunity(type: OpportunityType, form: FormData) {
  const deadline = type === 'contest' ? read(form, 'deadline') : null
  const deadlineDate = deadline ? new Date(deadline) : null
  if (deadlineDate && !Number.isFinite(deadlineDate.getTime()))
    throw new Error('MATCHING_INVALID_TYPE_FIELDS')
  return campusRpc<string>('create_matching_opportunity', {
    p_type: type,
    p_title: read(form, 'title'),
    p_description: read(form, 'description'),
    p_roles: tags(read(form, 'roles')),
    p_skills: tags(read(form, 'skills')),
    p_university_id: read(form, 'university'),
    p_major: read(form, 'major'),
    p_gap: type === 'idea' ? read(form, 'gap') : null,
    p_source_project_id: type === 'reboot' ? read(form, 'source_project') : null,
    p_competition: type === 'contest' ? read(form, 'competition') : null,
    p_format: type === 'contest' ? read(form, 'format') : null,
    p_deadline: deadlineDate?.toISOString() ?? null,
  })
}

export function submitOpportunity(id: string, form: FormData) {
  return campusRpc<string>('submit_matching_request', {
    p_opportunity_id: id,
    p_message: read(form, 'message'),
    p_role: read(form, 'role'),
    p_timezone: read(form, 'timezone'),
  })
}

export function listRequests(received: boolean, page: number) {
  return campusRpc<MatchingRequest[]>('list_matching_requests', {
    p_received: received,
    p_offset: page * matchingPageSize,
  })
}

export function decideRequest(id: string, accept: boolean) {
  return campusRpc<string | null>('decide_matching_request', { p_request_id: id, p_accept: accept })
}

export function closeOpportunity(id: string) {
  return campusRpc<void>('close_matching_opportunity', { p_opportunity_id: id })
}

const messages: Record<string, string> = {
  VERIFIED_UNIVERSITY_REQUIRED: '학교에서 발급한 Google 계정으로 다시 로그인해 주세요.',
  MATCHING_INVALID_DETAILS: '제목·소개 길이와 역할·역량 태그(최대 10개, 각 40자)를 확인해 주세요.',
  MATCHING_INVALID_TYPE_FIELDS: '선택한 유형의 필수 항목과 마감 일시를 확인해 주세요.',
  MATCHING_INVALID_UNIVERSITY: '현재 선택할 수 없는 대학입니다.',
  MATCHING_REBOOT_SOURCE_UNAVAILABLE: '중단·완료된 공개 프로젝트만 리부트할 수 있습니다.',
  MATCHING_OPPORTUNITY_UNAVAILABLE: '이 모집글을 찾을 수 없거나 관리 권한이 없습니다.',
  MATCHING_OPPORTUNITY_CLOSED: '이미 지원이 마감된 모집글입니다.',
  MATCHING_OWN_OPPORTUNITY: '내가 올린 모집글에는 지원할 수 없습니다.',
  MATCHING_DUPLICATE_REQUEST: '이미 이 모집글에 지원했습니다.',
  MATCHING_INVALID_MESSAGE: '지원 메시지는 2자 이상 2,000자 이하로 작성해 주세요.',
  MATCHING_INVALID_ROLE: '모집글에 표시된 역할을 선택해 주세요.',
  MATCHING_INVALID_TIMEZONE: '올바른 시간대를 입력해 주세요. 예: Asia/Seoul',
  MATCHING_REQUEST_UNAVAILABLE: '이 지원을 찾을 수 없거나 처리 권한이 없습니다.',
  MATCHING_REQUEST_DECIDED: '이미 처리한 지원입니다.',
  MATCHING_PROJECT_UNAVAILABLE: '연결된 팀 프로젝트가 더 이상 활성 상태가 아닙니다.',
  MATCHING_RATE_LIMIT: '최근 24시간 동안 모집글을 20개 등록했습니다. 나중에 다시 시도해 주세요.',
}

export function matchingError(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    Object.hasOwn(messages, error.message)
  ) {
    return messages[error.message]
  }
  return userError(error, fallback)
}
