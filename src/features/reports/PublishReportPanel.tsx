import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Field, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import {
  archiveKey,
  getWorkspace,
  publishReport,
  reportError,
  unpublishReport,
  workspaceKey,
  type Publication,
  type PublicText,
  type ReportKind,
  type ReportRevision,
} from './reports-api'

const fields = [
  { key: 'title', label: '공개 제목', limit: 100, required: true },
  { key: 'summary', label: '공개 요약', limit: 2000, required: true },
  { key: 'results', label: '공개할 결과', limit: 2000 },
  { key: 'lessons', label: '공개할 교훈', limit: 2000 },
  { key: 'handoff', label: '공개할 인수인계 안내', limit: 2000 },
] as const

export function PublishReportPanel({
  projectId,
  userId,
  kind,
  revision,
  publication,
}: {
  projectId: string
  userId: string
  kind: ReportKind
  revision: ReportRevision | null
  publication: Publication | null
}) {
  const cache = useQueryClient()
  const [publicText, setPublicText] = useState<PublicText>({ title: '', summary: '' })
  const [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState('')
  const ref = { p_project_id: projectId, p_kind: kind }
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: workspaceKey(userId, ref), exact: true }),
      cache.invalidateQueries({ queryKey: archiveKey }),
    ])
  const publish = useMutation({
    mutationFn: async ({
      revisionId,
      content,
      agreed,
    }: {
      revisionId: string
      content: PublicText
      agreed: boolean
    }) => {
      const result = await publishReport(ref, revisionId, agreed, content)
      const saved = (await getWorkspace(ref)).publication
      if (saved?.id !== result.id || saved.publishedAt !== result.publishedAt)
        throw new Error('REPORT_READBACK_FAILED')
    },
    onSettled: refresh,
    onSuccess: () => {
      setConsent(false)
      setNotice('공개 아카이브에 게시했습니다.')
    },
  })
  const withdraw = useMutation({
    mutationFn: async () => {
      await unpublishReport(ref)
      if ((await getWorkspace(ref)).publication) throw new Error('REPORT_READBACK_FAILED')
    },
    onSettled: refresh,
    onSuccess: () => {
      setConsent(false)
      setNotice('공개를 취소했습니다.')
    },
  })
  const pending = publish.isPending || withdraw.isPending
  const ready =
    Boolean(revision) &&
    Array.from(publicText.title.trim()).length >= 2 &&
    publicText.summary.trim() !== '' &&
    consent
  return (
    <section className="panel flow" aria-label="공개 아카이브 관리">
      <h2>공개 아카이브 관리</h2>
      {publication && (
        <div className="split-row">
          <span>
            현재 공개 중: {publication.title} ({publication.revisionNumber}판 기준)
          </span>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setNotice('')
              publish.reset()
              withdraw.mutate()
            }}
          >
            공개 취소
          </Button>
        </div>
      )}
      {notice && <Notice kind="success">{notice}</Notice>}
      {(publish.isError || withdraw.isError) && (
        <Notice kind="error">
          {reportError(
            publish.error ?? withdraw.error,
            '공개 변경을 확인하지 못했습니다. 현재 공개 상태를 확인한 뒤 다시 시도해 주세요.',
          )}
        </Notice>
      )}
      {!revision ? (
        <p className="muted">공개하려면 먼저 보고서 판을 저장하거나 선택해 주세요.</p>
      ) : (
        <form
          className="flow"
          onSubmit={(event) => {
            event.preventDefault()
            if (!ready || pending) return
            const content: PublicText = {
              title: publicText.title.trim(),
              summary: publicText.summary.trim(),
            }
            for (const key of ['results', 'lessons', 'handoff'] as const) {
              const text = publicText[key]?.trim()
              if (text) content[key] = text
            }
            setNotice('')
            withdraw.reset()
            publish.mutate({ revisionId: revision.id, content, agreed: consent })
          }}
        >
          <p className="muted">
            {revision.number}판을 기준으로 공개할 문안만 별도로 작성하세요. 내부 초안, 팀원 이름,
            근거 기록은 자동 복사되지 않습니다. 개인 정보, 내부 링크, 익명 피드백 및 체크인 내용을
            입력하지 마세요.
            {publication && ' 게시하면 기존 공개 문안을 교체합니다.'}
          </p>
          {fields.map(({ key, label, limit, ...config }) => {
            const id = `report-public-${key}`
            const props = {
              id,
              className: 'input',
              maxLength: limit,
              value: publicText[key] ?? '',
              disabled: pending,
              required: 'required' in config,
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                const value = event.target.value
                setPublicText((previous) => ({ ...previous, [key]: value }))
                setConsent(false)
              },
            }
            return (
              <Field key={key} id={id} label={label}>
                {key === 'title' ? (
                  <input {...props} minLength={2} />
                ) : (
                  <textarea {...props} rows={2} />
                )}
              </Field>
            )
          })}
          <label>
            <input
              type="checkbox"
              checked={consent}
              disabled={pending}
              onChange={(event) => setConsent(event.target.checked)}
            />{' '}
            위 문안을 누구나 볼 수 있는 아카이브에 공개하는 데 동의합니다.
          </label>
          <Button type="submit" disabled={!ready || pending}>
            {publish.isPending ? '게시 중…' : '아카이브에 공개'}
          </Button>
        </form>
      )}
      <Link className="text-link" to="/archive">
        공개 아카이브 보기
      </Link>
    </section>
  )
}
