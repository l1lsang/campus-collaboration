import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { Field, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-provider'
import {
  useReportDraft,
  type EditorBase,
  type EditorLayout,
  type EditorSection,
  type UnsavedReport,
} from './report-draft-state'
import { useReportWorkspaceKey } from './report-workspace-key'
import {
  getRevision,
  getWorkspace,
  previewReport,
  reportDate,
  reportError,
  reportLayoutLimits,
  reportLayoutSizeMessage,
  saveReportLayout,
  templateSectionLabels,
  type ReportKind,
  type ReportLayout,
  type ReportRevision,
  type ReportSection,
  type ReportWorkspace,
  type TemplateReportDraft,
} from './reports-api'

const {
  title: titleLimit,
  heading: headingLimit,
  body: bodyLimit,
  sections: sectionLimit,
} = reportLayoutLimits

function fromTemplate(title: string, draft: TemplateReportDraft): EditorLayout {
  return {
    title,
    source: 'template',
    sections: draft.sections.map(({ key, items }) => ({
      id: `template-${key}`,
      heading: templateSectionLabels[key],
      body: items.map(({ text }) => text).join('\n'),
    })),
  }
}

function initialLayout(title: string, revision: ReportRevision | null): EditorLayout {
  const draft = revision?.draft
  if (!draft) return { title, source: 'blank', sections: [] }
  if (draft.method === 'template') return fromTemplate(title, draft)
  return {
    title: draft.title,
    source: draft.source,
    sections: draft.sections.map((section, index) => ({ ...section, id: `saved-${index}` })),
  }
}

function editorBase(revision: ReportRevision | null): EditorBase | null {
  if (!revision) return null
  const { number, createdAt, draft } = revision
  return { number, createdAt, editable: draft.method === 'editable' }
}

function cleanReport(title: string, revision: ReportRevision | null) {
  return { base: editorBase(revision), layout: initialLayout(title, revision) }
}

function validate(layout: ReportLayout) {
  if (!layout.title) return '보고서 제목을 입력해 주세요.'
  if (Array.from(layout.title).length > titleLimit)
    return `보고서 제목은 ${titleLimit}자 이내로 입력해 주세요.`
  for (const [index, { heading, body }] of layout.sections.entries()) {
    if (!heading) return `${index + 1}번 섹션의 제목을 입력해 주세요.`
    if (Array.from(heading).length > headingLimit || Array.from(body).length > bodyLimit)
      return `${index + 1}번 섹션의 제목은 ${headingLimit}자, 본문은 ${bodyLimit}자 이내로 입력해 주세요.`
  }
  const bytes = new TextEncoder().encode(JSON.stringify(layout)).length
  // jsonb::text adds a space after each colon and comma: 5 at the root,
  // 3 per section object and 1 between adjacent array entries.
  const sections = layout.sections.length
  const jsonbSpacing = 5 + 3 * sections + Math.max(0, sections - 1)
  if (bytes + jsonbSpacing > reportLayoutLimits.bytes) return reportLayoutSizeMessage
  return ''
}

export function ReportDraftEditor({
  projectId,
  userId,
  kind,
  defaultTitle,
  latestRevision,
}: {
  projectId: string
  userId: string
  kind: ReportKind
  defaultTitle: string
  latestRevision: ReportRevision | null
}) {
  const cache = useQueryClient()
  const ref = { p_project_id: projectId, p_kind: kind }
  const key = useReportWorkspaceKey(userId, ref)
  const refresh = () => cache.invalidateQueries({ queryKey: key })
  const draftMemory = useReportDraft()
  const [localDraft, setLocalDraft] = useState<UnsavedReport | null>(null)
  const candidate = draftMemory ? draftMemory.draft : localDraft
  const draft = candidate?.kind === kind ? candidate : null
  const setDraft = draftMemory?.setDraft ?? setLocalDraft
  const [clean, setClean] = useState(() => cleanReport(defaultTitle, latestRevision))
  const { base, layout } = draft ?? clean
  const dirty = draft !== null
  const [validation, setValidation] = useState('')
  const [message, setMessage] = useState('')
  const nextSection = useRef(draft?.nextSection ?? 0)
  const { getVerifiedRequest } = useAuth()
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const access = () => (mounted.current ? getVerifiedRequest() : null)
  const requireEditorAccess = () => {
    const verified = access()
    if (!verified) throw new Error('REPORT_ACCESS_CHANGED')
    return verified
  }

  const edit = (next: EditorLayout) => {
    if (!access()) return
    setDraft({ kind, base, layout: next, nextSection: nextSection.current })
    setValidation('')
    setMessage('')
  }
  const template = useMutation({
    mutationFn: () => {
      requireEditorAccess()
      return previewReport(ref)
    },
    onSuccess: (starter) => edit(fromTemplate(layout.title, starter)),
  })
  const save = useMutation({
    mutationFn: async (content: ReportLayout) => {
      const verified = requireEditorAccess()
      const expected = base?.number ?? 0
      const result = await saveReportLayout(ref, expected, content, verified)
      requireEditorAccess()
      const confirmed = await getRevision(ref, result.id).catch(() => {
        throw new Error('REPORT_READBACK_FAILED')
      })
      const draft = confirmed?.draft
      if (
        confirmed?.id !== result.id ||
        confirmed.number !== expected + 1 ||
        confirmed.number !== result.number ||
        draft?.method !== 'editable' ||
        draft.title !== content.title ||
        draft.source !== content.source ||
        draft.sections.length !== content.sections.length ||
        !draft.sections.every(
          ({ heading, body }, index) =>
            heading === content.sections[index].heading && body === content.sections[index].body,
        )
      ) {
        throw new Error('REPORT_READBACK_FAILED')
      }
      return confirmed
    },
    onSuccess: (saved) => {
      if (!access()) return
      setClean(cleanReport(defaultTitle, saved))
      setDraft(null)
      setMessage(`${saved.number}판을 저장했습니다.`)
      cache.setQueryData<ReportWorkspace>(key, (previous) =>
        previous && (previous.latestRevision?.number ?? 0) <= saved.number
          ? { ...previous, latestRevision: saved }
          : previous,
      )
      return refresh()
    },
  })
  const reload = useMutation({
    mutationFn: async () => {
      await cache.cancelQueries({ queryKey: key, exact: true })
      requireEditorAccess()
      return getWorkspace(ref)
    },
    onSuccess: (latest) => {
      if (!access()) return
      setClean(cleanReport(defaultTitle, latest.latestRevision))
      setDraft(null)
      setValidation('')
      setMessage('최신판을 불러왔습니다.')
      cache.setQueryData(key, latest)
      save.reset()
      template.reset()
      return cache.invalidateQueries({ queryKey: [...key, 'history'] })
    },
  })
  const pending = template.isPending || save.isPending || reload.isPending
  const hasNewerRevision = (latestRevision?.number ?? 0) > (base?.number ?? 0)
  // Keep the base and fields together; only an untouched, idle editor follows the workspace.
  if (hasNewerRevision && !dirty && !pending) {
    setClean(cleanReport(defaultTitle, latestRevision))
    setValidation('')
  }
  const stale = hasNewerRevision && dirty
  const cannotSave = pending || stale || (!dirty && base?.editable)
  const draftError = stale
    ? { message: 'REPORT_REVISION_CONFLICT' }
    : (save.error ?? template.error)
  const updateSections = (sections: EditorSection[]) => edit({ ...layout, sections })
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= layout.sections.length) return
    const sections = layout.sections.slice()
    const [section] = sections.splice(index, 1)
    sections.splice(target, 0, section)
    updateSections(sections)
  }
  const updateSection = (id: string, value: Partial<ReportSection>) =>
    updateSections(
      layout.sections.map((section) => (section.id === id ? { ...section, ...value } : section)),
    )

  return (
    <section className="panel flow" aria-label="보고서 편집">
      <h2>보고서 편집</h2>
      <p className="muted">
        제목을 바꾸고 필요한 섹션만 남겨 주세요. 익명 피드백과 체크인 원문은 입력하지 마세요.
      </p>
      {base && (
        <p className="muted">
          편집 기준: {base.number}판 · {reportDate(base.createdAt)}
        </p>
      )}
      <form
        className="flow"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          if (cannotSave || !access()) return
          const content = {
            title: layout.title.trim(),
            source: layout.source,
            sections: layout.sections.map(({ heading, body }) => ({
              heading: heading.trim(),
              body,
            })),
          }
          const issue = validate(content)
          setValidation(issue)
          if (issue) return
          template.reset()
          reload.reset()
          save.mutate(content)
        }}
      >
        <Field id="report-draft-title" label="보고서 제목">
          <input
            id="report-draft-title"
            className="input"
            value={layout.title}
            required
            maxLength={titleLimit}
            disabled={pending}
            onChange={(event) => edit({ ...layout, title: event.target.value })}
          />
        </Field>
        {!base && !stale && layout.source === 'blank' && layout.sections.length === 0 && (
          <Button
            variant="outline"
            type="button"
            disabled={pending}
            onClick={() => template.mutate()}
          >
            {template.isPending ? '초안 생성 중…' : '템플릿 초안 만들기'}
          </Button>
        )}
        {layout.sections.map(({ id, heading, body }, index) => (
          <fieldset className="panel flow" key={id} disabled={pending}>
            <legend>섹션 {index + 1}</legend>
            <Field id={`report-${id}-heading`} label="제목">
              <input
                id={`report-${id}-heading`}
                className="input"
                required
                maxLength={headingLimit}
                value={heading}
                onChange={(event) => updateSection(id, { heading: event.target.value })}
              />
            </Field>
            <Field id={`report-${id}-body`} label="본문">
              <textarea
                id={`report-${id}-body`}
                className="input"
                rows={3}
                maxLength={bodyLimit}
                value={body}
                onChange={(event) => updateSection(id, { body: event.target.value })}
              />
            </Field>
            <div className="wrap">
              <Button
                type="button"
                variant="outline"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                위로
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={index === layout.sections.length - 1}
                onClick={() => move(index, 1)}
              >
                아래로
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-label={`${heading.trim() || `섹션 ${index + 1}`} 삭제`}
                onClick={() =>
                  updateSections(layout.sections.filter((section) => section.id !== id))
                }
              >
                삭제
              </Button>
            </div>
          </fieldset>
        ))}
        <div className="wrap">
          <Button
            type="button"
            variant="outline"
            disabled={pending || layout.sections.length >= sectionLimit}
            onClick={() =>
              updateSections([
                ...layout.sections,
                { id: `new-${nextSection.current++}`, heading: '', body: '' },
              ])
            }
          >
            섹션 추가
          </Button>
          <Button type="submit" disabled={cannotSave}>
            {save.isPending ? '저장 중…' : '새 판 저장'}
          </Button>
        </div>
        {validation && <Notice kind="error">{validation}</Notice>}
        {dirty && <p className="muted">저장되지 않은 변경이 있습니다.</p>}
        <p className="muted">
          저장하면 현재 제목과 구성을 팀원이 볼 수 있습니다. 이전 판은 보관되며 자동으로 공개되지
          않습니다.
        </p>
      </form>
      {message && <Notice kind="success">{message}</Notice>}
      {draftError && (
        <Notice kind="error">
          {reportError(draftError, '요청을 완료하지 못했습니다. 다시 시도해 주세요.')}
        </Notice>
      )}
      {reload.error && (
        <Notice kind="error">
          {reportError(reload.error, '최신판을 불러오지 못했습니다. 다시 시도해 주세요.')}
        </Notice>
      )}
      {(stale || save.isError) && (
        <Button type="button" variant="outline" disabled={pending} onClick={() => reload.mutate()}>
          현재 변경을 버리고 최신판 불러오기
        </Button>
      )}
    </section>
  )
}
