import { useQueryClient } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useAuth } from '../auth/auth-provider'
import {
  runProjectManagement,
  updateProjectManagementCache,
  usePendingProjectWrite,
  useUnresolvedProjectWrite,
  type ProjectManagementAction,
  type ProjectSummary,
} from './project-api'

const managementErrors: Record<string, string> = {
  PROJECT_MANAGEMENT_NOT_ALLOWED:
    '팀장만 프로젝트를 관리할 수 있어요. 현재 계정과 팀원 권한을 확인해 주세요.',
  PROJECT_DELETE_CONFIRMATION_REQUIRED: '삭제 내용을 확인한 뒤 다시 시도해 주세요.',
  PROJECT_HAS_RESEARCH:
    '연결된 연구 테스트와 크레딧 기록을 보호하기 위해 이 프로젝트는 삭제할 수 없어요. 기록을 남기려면 삭제 대신 마무리하세요.',
  PROJECT_CANNOT_COMPLETE: '현재 상태에서는 이 프로젝트를 마무리할 수 없어요.',
  PROJECT_MANAGEMENT_ACCOUNT_CHANGED:
    '로그인 계정이 바뀌었어요. 현재 계정과 프로젝트 상태를 확인해 주세요.',
  PROJECT_MANAGEMENT_CHECKING: '이전 요청의 결과를 확인하고 있어요. 잠시 후 다시 시도해 주세요.',
}

export function ProjectManagement({
  project,
  userId,
}: {
  project: ProjectSummary
  userId: string
}) {
  const panelId = useId()
  const cache = useQueryClient()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [action, setAction] = useState<ProjectManagementAction | null>(null)
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const entry = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const operation = useRef<AbortController | null>(null)
  const deleting = action === 'delete'
  const checking = usePendingProjectWrite(userId)
  const unresolved = useUnresolvedProjectWrite(userId, project.id)
  const blocked = checking || Boolean(unresolved)

  useLayoutEffect(() => () => operation.current?.abort(), [])

  function openConfirmation(nextAction: ProjectManagementAction, button: HTMLButtonElement) {
    trigger.current = button
    setError('')
    setConsent(false)
    setAction(nextAction)
  }

  async function confirm() {
    if (!action || blocked || operation.current || (deleting && !consent)) return
    const current = new AbortController()
    operation.current = current
    setError('')
    setPending(true)
    try {
      await runProjectManagement(
        cache,
        action,
        project,
        userId,
        session?.access_token,
        current.signal,
        () => {
          updateProjectManagementCache(cache, action, userId, project)
          if (deleting) {
            void navigate('/dashboard', { replace: true, state: { projectDeletedFor: userId } })
          } else {
            setAction(null)
            setExpanded(false)
            setCompleted(true)
          }
        },
      )
    } catch (failure) {
      if (!current.signal.aborted) {
        const details = failure && typeof failure === 'object' ? failure : {}
        const reason = [
          'message' in details && details.message,
          'code' in details && details.code,
        ].find(
          (value): value is string =>
            typeof value === 'string' && Object.hasOwn(managementErrors, value),
        )
        const fallback = `프로젝트 ${deleting ? '삭제' : '완료'}를 확인하지 못했습니다. 새로고침해 현재 상태를 확인해 주세요.`
        setError(reason ? managementErrors[reason] : fallback)
      }
    } finally {
      if (!current.signal.aborted) {
        operation.current = null
        setPending(false)
      }
    }
  }

  function recheck() {
    if (!unresolved || checking || session?.user.id !== userId) return
    setError('')
    void runProjectManagement(
      cache,
      unresolved,
      project,
      userId,
      session.access_token,
      new AbortController().signal,
      () => {},
      true,
    ).catch(() => setError('현재 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.'))
  }

  const verification = unresolved ? (
    <div className="flow">
      <Notice>이전 요청의 결과가 아직 확인되지 않았어요. 상태를 다시 조회할 수 있습니다.</Notice>
      <Button variant="outline" disabled={checking} onClick={recheck}>
        결과 다시 확인
      </Button>
    </div>
  ) : checking && !pending ? (
    <Notice>이전 요청의 결과를 확인하고 있어요.</Notice>
  ) : null

  return (
    <>
      <Button
        ref={entry}
        variant="outline"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(!expanded)}
      >
        프로젝트 관리
      </Button>
      {completed && <Notice kind="success">프로젝트를 마무리했어요.</Notice>}
      {!action && verification}
      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <section className="flow border-t border-(--border) pt-4" aria-label="프로젝트 관리">
            <p className="muted">팀장만 프로젝트를 마무리하거나 삭제할 수 있습니다.</p>
            <div className="flow gap-2">
              <h3>프로젝트 마무리</h3>
              <p className="muted">
                {project.status === 'archived'
                  ? '보관한 프로젝트는 마무리할 수 없어요.'
                  : '상태를 완료로 바꾸고 팀플로그와 보고서는 남겨요. 공개 범위는 그대로 유지합니다.'}
              </p>
              <Button
                variant="outline"
                disabled={
                  blocked || project.status === 'completed' || project.status === 'archived'
                }
                onClick={(event) => openConfirmation('complete', event.currentTarget)}
              >
                {project.status === 'completed' ? '마무리한 프로젝트' : '마무리하기'}
              </Button>
            </div>
            <div className="flow gap-2 border-t border-(--border) pt-3">
              <h3 className="text-[#a32d36]">프로젝트 삭제</h3>
              <p className="muted">
                프로젝트와 팀 기록에 더 이상 접근할 수 없어요. 삭제는 되돌릴 수 없습니다.
              </p>
              <Button
                variant="outline"
                disabled={blocked}
                onClick={(event) => openConfirmation('delete', event.currentTarget)}
              >
                삭제 확인으로
              </Button>
            </div>
          </section>
        )}
      </div>
      <AlertDialog.Root
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !operation.current) setAction(null)
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
          <AlertDialog.Content
            className="panel flow fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[calc(100dvh-2rem)] max-w-xl -translate-y-1/2 overflow-y-auto shadow-xl"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const previous = trigger.current?.isConnected ? trigger.current : entry.current
              previous?.focus()
            }}
            onEscapeKeyDown={(event) => {
              if (operation.current) event.preventDefault()
            }}
          >
            <header>
              <p className="eyebrow">{project.title}</p>
              <AlertDialog.Title>
                {deleting ? '프로젝트를 삭제할까요?' : '프로젝트를 마무리할까요?'}
              </AlertDialog.Title>
            </header>
            <AlertDialog.Description asChild>
              <div className="flow">
                {deleting ? (
                  <>
                    <p>삭제는 되돌릴 수 없습니다.</p>
                    <div className="notice notice-error">
                      <div>
                        <strong>팀원도 더 이상 볼 수 없어요</strong>
                        <p>
                          프로젝트 상세, 팀플로그와 보고서에 접근할 수 없게 됩니다. 기록이
                          필요하다면 삭제 대신 마무리하세요.
                        </p>
                        <p>공개한 보고서도 경험 아카이브에서 내려갑니다.</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p>마무리하면 대시보드의 ‘완료한 프로젝트’에 표시됩니다.</p>
                    <div className="border-t border-(--border) pt-2">
                      <strong>기록은 그대로 남아요</strong>
                      <p className="muted">팀원은 팀플로그와 저장된 보고서를 계속 볼 수 있어요.</p>
                    </div>
                    <div className="border-t border-(--border) pt-2">
                      <strong>공개 범위는 바뀌지 않아요</strong>
                      <p className="muted">
                        {project.visibility === 'private'
                          ? '이 프로젝트는 계속 팀원만 볼 수 있어요.'
                          : '이 프로젝트는 계속 전체 공개 상태로 유지돼요.'}
                      </p>
                    </div>
                  </>
                )}
                <div className="border-t border-(--border) pt-2">
                  <strong>연결된 모집과 지원</strong>
                  <p className="muted">
                    이 프로젝트에 직접 연결된 모집글이 있다면 마감되고, 검토 중인 지원은 거절됩니다.
                    이 프로젝트를 리부트 원본으로만 참조하는 모집글의 모집 상태와 지원은 그대로예요.
                  </p>
                </div>
              </div>
            </AlertDialog.Description>
            {deleting && (
              <label className="wrap font-semibold">
                <input
                  className="size-5 accent-primary"
                  type="checkbox"
                  checked={consent}
                  disabled={pending}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                삭제 내용을 확인했습니다.
              </label>
            )}
            {error && <Notice kind="error">{error}</Notice>}
            {verification}
            <div className="wrap">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={pending}>
                  취소
                </Button>
              </AlertDialog.Cancel>
              <Button
                variant={deleting ? (consent ? 'danger' : 'outline') : 'primary'}
                disabled={
                  pending ||
                  blocked ||
                  (deleting && !consent) ||
                  (!deleting && project.status === 'completed')
                }
                onClick={() => void confirm()}
              >
                {deleting
                  ? pending
                    ? '삭제 중…'
                    : '프로젝트 삭제'
                  : pending
                    ? '완료로 변경 중…'
                    : '완료로 변경'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  )
}
