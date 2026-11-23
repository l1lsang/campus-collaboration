import { getSupabase } from '../../lib/supabase/client'
import { campusRpc } from '../../lib/supabase/rpc'

export const reportKinds = {
  activity: '활동 보고서',
  contribution: '기여 보고서',
  failure: '실패 회고',
  handoff: '인수인계 보고서',
} as const
export type ReportKind = keyof typeof reportKinds

export const reportInputLabels = {
  goals: '프로젝트 목표',
  roles: '맡은 업무 및 역할',
  results: '확인된 결과',
  explanation: '설명 및 판단 근거',
  failure: '실패·미달 사실',
  nextSteps: '후속 조치',
  handoff: '인수인계 자료 및 방법',
} as const
export type ReportInputKey = keyof typeof reportInputLabels
export type ReportInputs = Partial<Record<ReportInputKey, string>>
export const templateSectionLabels = {
  ...reportInputLabels,
  context: '프로젝트 개요',
  activity: '활동 타임라인',
}
export type TemplateReportDraft = {
  method: 'template'
  sections: {
    key: keyof typeof templateSectionLabels
    items: { text: string; sourceIds: string[] }[]
  }[]
  notes: string[]
}
export type ReportSection = { heading: string; body: string }
export type ReportLayout = {
  title: string
  source: 'template' | 'blank'
  sections: ReportSection[]
}
export type EditableReportDraft = ReportLayout & { method: 'editable' }
export type ReportDraft = TemplateReportDraft | EditableReportDraft
export const reportLayoutLimits = {
  title: 120,
  heading: 120,
  body: 24000,
  sections: 24,
  bytes: 262_144,
} as const
export const reportLayoutSizeMessage = `보고서 전체는 ${reportLayoutLimits.bytes.toLocaleString('ko-KR')}바이트 이내여야 합니다. 섹션 본문을 줄이거나 불필요한 섹션을 삭제해 주세요.`
export type RevisionHeader = { id: string; number: number; createdAt: string }
export type ReportRevision = RevisionHeader & { inputs: ReportInputs; draft: ReportDraft }
export type PublicText = {
  title: string
  summary: string
  results?: string
  lessons?: string
  handoff?: string
}
export type ArchiveEntry = PublicText & { id: string; kind: ReportKind; publishedAt: string }
export type Publication = ArchiveEntry & { revisionNumber: number }
export type ReportWorkspace = {
  title: string
  isOwner: boolean
  latestRevision: ReportRevision | null
  publication: Publication | null
}

type ReportRef = { p_project_id: string; p_kind: ReportKind }
export const workspaceKey = (userId: string, ref: ReportRef) =>
  ['account', userId, 'reports', ref] as const
export const archiveKey = ['public', 'report-archive'] as const
export const historyPageSize = 30
export const archivePageSize = 24

export const getWorkspace = (ref: ReportRef) =>
  campusRpc<ReportWorkspace>('get_project_report_workspace', ref)
export const listRevisions = (ref: ReportRef, before: number | null) =>
  campusRpc<RevisionHeader[]>('list_project_report_revisions', { ...ref, p_before: before })
export const getRevision = (ref: ReportRef, id: string) =>
  campusRpc<ReportRevision>('get_project_report_revision', { ...ref, p_revision_id: id })
export const previewReport = (ref: ReportRef) =>
  campusRpc<TemplateReportDraft>('preview_project_report', { ...ref, p_inputs: {} })
export async function saveReportLayout(
  ref: ReportRef,
  expectedNumber: number,
  layout: ReportLayout,
  { accessToken, signal }: { accessToken: string; signal: AbortSignal },
) {
  signal.throwIfAborted()
  const { data, error } = await getSupabase()
    .rpc(
      'save_project_report_layout' as never,
      {
        ...ref,
        p_expected_number: expectedNumber,
        p_layout: layout,
      } as never,
    )
    // The SDK may asynchronously obtain a different session before fetch. Pin
    // this private write to the verified token and abort on any transition.
    .setHeader('Authorization', `Bearer ${accessToken}`)
    .abortSignal(signal)
  if (error) throw error
  return data as ReportRevision
}
export const publishReport = (
  ref: ReportRef,
  revisionId: string,
  consent: boolean,
  content: PublicText,
) =>
  campusRpc<Publication>('publish_project_report', {
    ...ref,
    p_revision_id: revisionId,
    p_opt_in: consent,
    p_content: content,
  })
export const unpublishReport = (ref: ReportRef) => campusRpc<void>('unpublish_project_report', ref)
export const listArchive = (before: Pick<ArchiveEntry, 'publishedAt' | 'id'> | null) =>
  campusRpc<ArchiveEntry[]>('list_report_archive', {
    p_before: before?.publishedAt ?? null,
    p_before_id: before?.id ?? null,
  })

const errors: Record<string, string> = {
  PROJECT_MEMBER_REQUIRED: '이 프로젝트의 팀원만 보고서를 이용할 수 있습니다.',
  PROJECT_OWNER_REQUIRED: '프로젝트 소유자만 보고서를 편집하거나 공개 설정을 바꿀 수 있습니다.',
  VERIFIED_UNIVERSITY_REQUIRED: '보고서를 이용하려면 학교 인증이 필요합니다.',
  PROFILE_REQUIRED: '보고서를 이용하려면 프로필을 먼저 작성해 주세요.',
  REPORT_INVALID_INPUT: '입력한 문안의 길이와 필수 항목을 확인해 주세요.',
  REPORT_LAYOUT_TOO_LARGE: reportLayoutSizeMessage,
  REPORT_REVISION_CONFLICT:
    '편집하는 동안 최신판이 바뀌었습니다. 변경 내용을 확인하고 최신판을 불러와 주세요.',
  REPORT_READBACK_FAILED: '저장 결과를 확인하지 못했습니다. 최신판을 확인해 주세요.',
  REPORT_REVISION_NOT_FOUND: '선택한 판을 찾을 수 없습니다.',
  REPORT_PUBLIC_OPT_IN_REQUIRED: '공개 문안을 확인하고 공개에 동의해 주세요.',
}
export function reportError(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return Object.hasOwn(errors, error.message) ? errors[error.message] : fallback
  }
  return fallback
}

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
export const reportDate = (date: string) => dateTime.format(new Date(date))
