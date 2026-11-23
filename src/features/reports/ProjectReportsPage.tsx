import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { z } from 'zod'
import { Field, Loading, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-provider'
import { PublishReportPanel } from './PublishReportPanel'
import { ReportDraftEditor } from './ReportDraftEditor'
import { useReportDraft } from './report-draft-state'
import { useReportWorkspaceKey } from './report-workspace-key'
import {
  getRevision,
  getWorkspace,
  historyPageSize,
  listRevisions,
  reportDate,
  reportError,
  reportKinds,
  templateSectionLabels,
  type ReportKind,
  type ReportRevision,
  type ReportWorkspace as Workspace,
} from './reports-api'

const kinds = Object.keys(reportKinds) as ReportKind[]
const sourceLabels: Record<string, string> = {
  project: '프로젝트 정보',
  membership: '팀원 명단',
  role: '배정된 역할',
  task: '작업 보드',
  activity: '팀 활동 기록',
  input: '팀원 입력',
}

type Scope = { projectId: string; userId: string; kind: ReportKind }

function RevisionPreview({ revision, label }: { revision: ReportRevision; label: string }) {
  const { draft } = revision
  if (draft.method === 'editable') {
    return (
      <section className="panel flow" aria-label={label}>
        <p className="muted">{label}</p>
        <h2 className="wrap-anywhere">{draft.title}</h2>
        {draft.source === 'template' && <span className="chip">템플릿에서 시작</span>}
        {draft.sections.map(({ heading, body }, index) => (
          <section key={index} className="flow wrap-anywhere">
            <h3>{heading}</h3>
            {body && <p className="preserve-text">{body}</p>}
          </section>
        ))}
      </section>
    )
  }
  return (
    <section className="panel flow">
      <h2>{label}</h2>
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
          <h3>{templateSectionLabels[key]}</h3>
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
  const key = useReportWorkspaceKey(userId, ref)
  const history = useInfiniteQuery({
    queryKey: [...key, 'history'],
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
  const key = useReportWorkspaceKey(userId, ref)
  const history = useQuery({
    queryKey: [...key, 'revision', selected],
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
      {workspace.isOwner ? (
        <ReportDraftEditor
          projectId={projectId}
          userId={userId}
          kind={kind}
          defaultTitle={`${workspace.title} · ${reportKinds[kind]}`}
          latestRevision={workspace.latestRevision}
        />
      ) : (
        <p className="muted">
          저장된 보고서를 볼 수 있습니다. 편집은 프로젝트 소유자만 할 수 있습니다.
        </p>
      )}
      {workspace.latestRevision && !selected && (
        <RevisionPreview
          revision={workspace.latestRevision}
          label={`${workspace.latestRevision.number}판 보고서`}
        />
      )}
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
            <RevisionPreview revision={history.data} label={`이력 · ${history.data.number}판`} />
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
  const key = useReportWorkspaceKey(userId, ref)
  const setDraft = useReportDraft()?.setDraft
  const workspace = useQuery({
    queryKey: key,
    queryFn: () => getWorkspace(ref),
    retry: false,
    gcTime: 0,
  })
  const accessDenied = [
    'PROJECT_MEMBER_REQUIRED',
    'VERIFIED_UNIVERSITY_REQUIRED',
    'PROFILE_REQUIRED',
  ].includes(workspace.error?.message ?? '')
  const discardDraft = !workspace.isPending && (accessDenied || !workspace.data?.isOwner)
  useEffect(() => {
    if (discardDraft) setDraft?.(null)
  }, [discardDraft, setDraft])

  if (workspace.isPending) return <Loading />
  if (!workspace.data || accessDenied)
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
      {workspace.isError && (
        <Notice>
          최신 내용을 불러오지 못해 마지막으로 불러온 보고서를 표시합니다.{' '}
          <button type="button" className="text-link" onClick={() => void workspace.refetch()}>
            다시 시도
          </button>
        </Notice>
      )}
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
  const draftMemory = useReportDraft()
  const [kind, setKind] = useState<ReportKind>(draftMemory?.draft?.kind ?? 'activity')
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
        description="팀 내부 보고서의 저장된 판과 편집 이력을 확인합니다."
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
                if (selected && selected !== kind) {
                  draftMemory?.setDraft(null)
                  setKind(selected)
                }
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
