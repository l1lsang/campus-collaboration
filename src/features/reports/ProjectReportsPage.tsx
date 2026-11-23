import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { z } from 'zod'
import { Field, Loading, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-provider'
import { PublishReportPanel } from './PublishReportPanel'
import {
  getRevision,
  getWorkspace,
  historyPageSize,
  listRevisions,
  previewReport,
  reportDate,
  reportError,
  reportInputLabels,
  reportKinds,
  saveReport,
  workspaceKey,
  type ReportDraft,
  type ReportInputKey,
  type ReportInputs,
  type ReportKind,
  type ReportRevision,
  type ReportWorkspace as Workspace,
} from './reports-api'

const kinds = Object.keys(reportKinds) as ReportKind[]
const inputs = Object.entries(reportInputLabels) as [ReportInputKey, string][]
const sectionLabels = { ...reportInputLabels, context: '프로젝트 개요', activity: '활동 타임라인' }
const sourceLabels: Record<string, string> = {
  project: '프로젝트 정보',
  membership: '팀원 명단',
  role: '배정된 역할',
  task: '작업 보드',
  activity: '팀 활동 기록',
  input: '팀원 입력',
}

type Scope = { projectId: string; userId: string; kind: ReportKind }

function DraftView({ draft, title }: { draft: ReportDraft; title: string }) {
  return (
    <section className="panel flow">
      <h2>{title}</h2>
      <span className="chip">템플릿 초안</span>
      {draft.notes.length > 0 && (
        <ul className="muted">
          {draft.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {draft.sections.map(({ key, items }) => (
        <section key={key} className="flow">
          <h3>{sectionLabels[key]}</h3>
          {items.length > 0 ? (
            <ul className="divided-list">
              {items.map((item, index) => {
                const labels = [
                  ...new Set(
                    item.sourceIds.map((id) => sourceLabels[id.split(':')[0]]).filter(Boolean),
                  ),
                ]
                return (
                  <li key={`${item.sourceIds[0]}-${index}`}>
                    <p className="preserve-text">{item.text}</p>
                    {labels.length > 0 && <small className="muted">{labels.join(' · ')}</small>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted">확인된 기록이 없습니다.</p>
          )}
        </section>
      ))}
    </section>
  )
}

function ReportEditor({
  projectId,
  userId,
  kind,
  initialRevision,
}: Scope & { initialRevision: ReportRevision | null }) {
  const cache = useQueryClient()
  const ref = { p_project_id: projectId, p_kind: kind }
  const [base, setBase] = useState(initialRevision)
  const [edits, setEdits] = useState<ReportInputs>(initialRevision?.inputs ?? {})
  const [draft, setDraft] = useState<ReportDraft | null>(null)
  const [message, setMessage] = useState('')
  const key = workspaceKey(userId, ref)
  const refresh = () => cache.invalidateQueries({ queryKey: key })
  const preview = useMutation({
    mutationFn: (values: ReportInputs) => previewReport(ref, values),
    onSuccess: setDraft,
  })
  const save = useMutation({
    mutationFn: async (values: ReportInputs) => {
      const result = await saveReport(ref, base?.number ?? 0, values)
      const confirmed = await getRevision(ref, result.id)
      if (confirmed.id !== result.id || confirmed.number !== result.number)
        throw new Error('REPORT_READBACK_FAILED')
      return confirmed
    },
    onSuccess: (saved) => {
      setBase(saved)
      setEdits(saved.inputs)
      setDraft(null)
      setMessage(`${saved.number}판을 저장했습니다.`)
      return refresh()
    },
  })
  const reload = useMutation({
    mutationFn: () => getWorkspace(ref),
    onSuccess: ({ latestRevision }) => {
      setBase(latestRevision)
      setEdits(latestRevision?.inputs ?? {})
      setDraft(null)
      setMessage('최신판을 불러왔습니다.')
      return refresh()
    },
  })
  const pending = preview.isPending || save.isPending || reload.isPending
  const error = reload.error ?? save.error ?? preview.error
  return (
    <>
      <section className="panel flow" aria-label="보고서 편집">
        <h2>보고서 편집</h2>
        <p className="muted">
          프로젝트 정보와 허용된 팀 활동 기록을 바탕으로 초안을 만듭니다. 추가로 확인한 내용만 적어
          주세요. 익명 피드백과 체크인 원문은 입력하지 마세요.
        </p>
        {base && (
          <p className="muted">
            편집 기준: {base.number}판 · {reportDate(base.createdAt)}
          </p>
        )}
        <form
          className="flow"
          onSubmit={(event) => {
            event.preventDefault()
            if (pending) return
            setMessage('')
            preview.reset()
            reload.reset()
            save.mutate(edits)
          }}
        >
          {inputs.map(([key, label]) => {
            const id = `report-input-${key}`
            return (
              <Field key={key} id={id} label={label}>
                <textarea
                  id={id}
                  className="input"
                  rows={2}
                  maxLength={2000}
                  value={edits[key] ?? ''}
                  disabled={pending}
                  onChange={(event) => {
                    const value = event.target.value
                    setEdits((previous) => ({ ...previous, [key]: value }))
                    setDraft(null)
                    setMessage('')
                  }}
                />
              </Field>
            )
          })}
          <div className="split-row">
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={() => {
                setMessage('')
                save.reset()
                reload.reset()
                preview.mutate(edits)
              }}
            >
              {preview.isPending ? '초안 생성 중…' : '템플릿 초안 만들기'}
            </Button>
            <Button type="submit" disabled={pending}>
              {save.isPending ? '저장 중…' : '새 판 저장'}
            </Button>
          </div>
          <p className="muted">
            저장할 때 최신 활동 근거로 다시 생성합니다. 이전 판은 그대로 유지됩니다.
          </p>
        </form>
        {message && <Notice kind="success">{message}</Notice>}
        {error && (
          <Notice kind="error">
            {reportError(error, '요청을 완료하지 못했습니다. 저장한 경우 최신판을 확인해 주세요.')}
          </Notice>
        )}
        {save.isError && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setMessage('')
              reload.mutate(undefined, { onSuccess: () => save.reset() })
            }}
          >
            현재 입력을 버리고 최신판 불러오기
          </Button>
        )}
      </section>
      {draft ? (
        <DraftView draft={draft} title="저장 전 미리보기" />
      ) : (
        base && <DraftView draft={base.draft} title={`${base.number}판 보고서`} />
      )}
    </>
  )
}

function RevisionHistory({
  projectId,
  userId,
  kind,
  selected,
  select,
  latestId,
}: Scope & {
  selected: string | null
  select: (id: string | null) => void
  latestId: string | undefined
}) {
  const ref = { p_project_id: projectId, p_kind: kind }
  const history = useInfiniteQuery({
    queryKey: [...workspaceKey(userId, ref), 'history'],
    queryFn: ({ pageParam }) => listRevisions(ref, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => (page.length === historyPageSize ? page.at(-1)?.number : undefined),
    retry: false,
    gcTime: 0,
  })
  const entries = history.data?.pages.flat() ?? []
  return (
    <section className="panel flow" aria-label="보고서 판 이력">
      <h2>판 이력</h2>
      {history.isPending ? (
        <Loading />
      ) : history.isError && !history.data ? (
        <Notice kind="error">
          이력을 불러오지 못했습니다.{' '}
          <button type="button" className="text-link" onClick={() => void history.refetch()}>
            다시 시도
          </button>
        </Notice>
      ) : entries.length === 0 ? (
        <p className="muted">아직 저장된 판이 없습니다.</p>
      ) : (
        <ul className="divided-list">
          {entries.map(({ id, number, createdAt }) => (
            <li key={id} className="split-row">
              <div>
                {number}판 {id === latestId && <span className="chip">최신</span>}{' '}
                <time className="muted" dateTime={createdAt}>
                  {reportDate(createdAt)}
                </time>
              </div>
              <Button
                variant="outline"
                type="button"
                aria-pressed={selected === id}
                onClick={() => select(selected === id ? null : id)}
              >
                {selected === id ? `${number}판 닫기` : `${number}판 보기`}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {history.isFetchNextPageError && <Notice kind="error">이전 판을 불러오지 못했습니다.</Notice>}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          이전 판 더 보기
        </Button>
      )}
    </section>
  )
}

function ReportContents({ projectId, userId, kind, workspace }: Scope & { workspace: Workspace }) {
  const [selected, setSelected] = useState<string | null>(null)
  const ref = { p_project_id: projectId, p_kind: kind }
  const history = useQuery({
    queryKey: [...workspaceKey(userId, ref), 'revision', selected],
    queryFn: selected ? () => getRevision(ref, selected) : skipToken,
    retry: false,
    gcTime: 0,
  })
  const current = selected
    ? history.isError
      ? null
      : (history.data ?? null)
    : workspace.latestRevision
  return (
    <div className="flow">
      <ReportEditor
        projectId={projectId}
        userId={userId}
        kind={kind}
        initialRevision={workspace.latestRevision}
      />
      <RevisionHistory
        projectId={projectId}
        userId={userId}
        kind={kind}
        selected={selected}
        select={setSelected}
        latestId={workspace.latestRevision?.id}
      />
      {selected &&
        (history.isPending ? (
          <Loading label="선택한 판 불러오는 중…" />
        ) : history.isError ? (
          <Notice kind="error">
            {reportError(history.error, '선택한 판을 불러오지 못했습니다.')}
          </Notice>
        ) : (
          history.data && (
            <DraftView draft={history.data.draft} title={`이력 · ${history.data.number}판`} />
          )
        ))}
      {workspace.isOwner && (
        <PublishReportPanel
          key={current?.id ?? 'empty'}
          projectId={projectId}
          userId={userId}
          kind={kind}
          revision={current}
          publication={workspace.publication}
        />
      )}
    </div>
  )
}

function ReportWorkspace({ projectId, userId, kind }: Scope) {
  const ref = { p_project_id: projectId, p_kind: kind }
  const workspace = useQuery({
    queryKey: workspaceKey(userId, ref),
    queryFn: () => getWorkspace(ref),
    retry: false,
    gcTime: 0,
  })
  if (workspace.isPending) return <Loading />
  if (workspace.isError)
    return (
      <Notice kind="error">
        {reportError(workspace.error, '보고서 작업공간을 불러오지 못했습니다.')}{' '}
        <button type="button" className="text-link" onClick={() => void workspace.refetch()}>
          다시 시도
        </button>
      </Notice>
    )
  return (
    <>
      <h2>
        {workspace.data.title} · {reportKinds[kind]}
      </h2>
      <ReportContents
        projectId={projectId}
        userId={userId}
        kind={kind}
        workspace={workspace.data}
      />
    </>
  )
}

export function ProjectReportsPage() {
  const { id } = useParams()
  const auth = useAuth()
  const [kind, setKind] = useState<ReportKind>('activity')
  const projectId = z.uuid().safeParse(id)
  const userId = auth.session?.user.id
  return (
    <main className="container page" id="main-content">
      {projectId.success && (
        <Link className="back-link" to={`/projects/${projectId.data}`}>
          프로젝트로 돌아가기
        </Link>
      )}
      <PageHeading
        title="프로젝트 보고서"
        description="팀원용 초안을 생성하고 저장한 판을 검토합니다."
      />
      {!projectId.success ? (
        <Notice kind="error">유효한 프로젝트 주소가 아닙니다.</Notice>
      ) : auth.loading ? (
        <Loading />
      ) : !userId ? (
        <Notice>
          로그인한 팀원만 보고서를 이용할 수 있습니다.{' '}
          <Link
            className="text-link"
            to="/login"
            state={{ next: `/projects/${projectId.data}/reports` }}
          >
            로그인
          </Link>
        </Notice>
      ) : (
        <div className="flow">
          <Field id="report-kind" label="보고서 유형">
            <select
              id="report-kind"
              className="input"
              value={kind}
              onChange={(event) => {
                const selected = kinds.find((kind) => kind === event.target.value)
                if (selected) setKind(selected)
              }}
            >
              {kinds.map((kind) => (
                <option value={kind} key={kind}>
                  {reportKinds[kind]}
                </option>
              ))}
            </select>
          </Field>
          <ReportWorkspace
            key={`${projectId.data}:${userId}:${kind}`}
            projectId={projectId.data}
            userId={userId}
            kind={kind}
          />
        </div>
      )}
    </main>
  )
}
