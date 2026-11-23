import { useId, useState } from 'react'
import { Link } from 'react-router'
import { Field, Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { getSupabase } from '../../lib/supabase/client'
import { useAuth } from '../auth/auth-provider'
import {
  closeResearchTest,
  confirmResearchParticipation,
  rejectSurveyCompletion,
  researchError,
  safeTestUrl,
  submitResearchFeedback,
  submitSurveyCompletion,
  useResearchCredits,
  useResearchMutation,
  useResearchWork,
  type CreditLedger,
  type ResearchPath,
  type ResearchWork,
} from './research-api'

const statuses = {
  applied: '신청 완료',
  submitted: '피드백 제출 · 확인 대기',
  confirmed: '보상 지급 완료',
  rejected: '응답 완료 거절 · 보상 없음',
}
const ledgerLabels: Record<CreditLedger['entries'][number]['kind'], string> = {
  starter: '첫 이용 지급',
  reserve: '모집 보상 예약',
  release: '미사용 크레딧 환급',
  spend: '참여자 보상 지급',
  award: '참여 보상 받음',
}
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' })

export function ResearchAccountError({
  error,
  fallback,
  next,
  retry,
}: {
  error: unknown
  fallback: string
  next: ResearchPath
  retry?: () => void
}) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : null
  if (message === 'VERIFIED_UNIVERSITY_REQUIRED' || message === 'SCHOOL_VERIFICATION_REVOKED')
    return <ResearchSchoolError />

  return (
    <Notice kind="error">
      {researchError(error, fallback)}{' '}
      {message === 'PROFILE_REQUIRED' ? (
        <Link className="text-link" to="/onboarding" state={{ next }}>
          프로필 작성
        </Link>
      ) : retry ? (
        <button className="text-link" type="button" onClick={retry}>
          다시 시도
        </button>
      ) : null}
    </Notice>
  )
}

function ResearchSchoolError() {
  const { retryVerification } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)

  async function signOut() {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      // Let the auth provider clear the session before the research route offers its login link.
      const { error } = await getSupabase().auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch {
      setSignOutFailed(true)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <Notice kind="error">
      <p>
        현재 세션의 학교 인증을 확인할 수 없습니다. 다시 확인하거나 로그아웃 후 학교 계정으로
        로그인해 주세요.
      </p>
      <div className="research-nav">
        <Button variant="outline" disabled={signingOut} onClick={retryVerification}>
          학교 인증 다시 확인
        </Button>
        <Button variant="outline" disabled={signingOut} onClick={() => void signOut()}>
          {signingOut ? '로그아웃 중…' : '로그아웃'}
        </Button>
      </div>
      {signOutFailed && <p>로그아웃하지 못했습니다. 다시 시도해 주세요.</p>}
    </Notice>
  )
}

export function ResearchWorkPage({ userId }: { userId: string }) {
  const work = useResearchWork(userId)
  if (work.isPending) return <Loading />
  if (work.isError)
    return (
      <ResearchAccountError
        error={work.error}
        fallback="리서치 내역을 불러오지 못했습니다."
        next="/research/mine"
        retry={() => void work.refetch()}
      />
    )

  return (
    <div className="flow">
      <section className="flow" aria-labelledby="research-participating">
        <h2 id="research-participating">참여한 리서치</h2>
        {!work.data.participating.length && <Notice>참여한 리서치가 없습니다.</Notice>}
        {work.data.participating.map((entry) => (
          <ParticipationCard key={entry.id} entry={entry} userId={userId} />
        ))}
      </section>
      <section className="flow" aria-labelledby="research-organized">
        <h2 id="research-organized">진행하는 모집</h2>
        {!work.data.organized.length && <Notice>진행하는 모집이 없습니다.</Notice>}
        {work.data.organized.map((test) => (
          <OrganizerCard key={test.id} test={test} userId={userId} />
        ))}
      </section>
    </div>
  )
}

function ParticipationCard({
  entry,
  userId,
}: {
  entry: ResearchWork['participating'][number]
  userId: string
}) {
  const feedbackId = useId()
  const [feedback, setFeedback] = useState('')
  const submit = useResearchMutation(userId, submitResearchFeedback)
  const isSurvey = entry.kind === 'survey'
  const open = entry.test_status === 'open'
  const canOpenLink = open && entry.status !== 'rejected'
  const url = canOpenLink ? safeTestUrl(entry.test_url) : null
  const length = Array.from(feedback.trim()).length
  const status =
    !open && entry.status === 'applied'
      ? '모집 종료 · 보상 없음'
      : isSurvey && entry.status === 'submitted'
        ? '응답 완료 신고 · 확인 대기'
        : statuses[entry.status]
  return (
    <article className="panel flow">
      {isSurvey && <p className="muted text-sm">외부 설문</p>}
      <h3>{entry.title}</h3>
      <p className="muted">
        {status}
        {entry.status === 'confirmed'
          ? ` · ${entry.reward} 크레딧`
          : entry.status === 'submitted' || (open && entry.status === 'applied')
            ? ` · 참여 보상 ${entry.reward} 크레딧`
            : null}
      </p>
      <p className="research-text">{entry.description}</p>
      {isSurvey && entry.confirmation_code && (
        <>
          <p className="research-text">
            참여 확인 코드: <code>{entry.confirmation_code}</code>
          </p>
          {url && entry.status === 'applied' && (
            <p className="muted text-sm">
              외부 폼의 ‘참여 확인 코드’ 질문에 위 코드를 입력하고 응답을 제출하세요. 이 앱은 외부
              응답을 가져오거나 자동으로 검증하지 않습니다.
            </p>
          )}
        </>
      )}
      {url && (
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {isSurvey ? '외부 설문 열기 (새 탭)' : '테스트 열기'}
          </a>
        </Button>
      )}
      {canOpenLink && !url && (
        <Notice>{isSurvey ? '설문' : '테스트'} 주소를 열 수 없습니다.</Notice>
      )}
      {isSurvey && url && (
        <p className="research-text muted text-sm">
          이동 주소: {new URL(url).host}. 응답은 외부 폼에만 제출되며, 링크를 여는 것만으로는 참여가
          완료되지 않습니다.
        </p>
      )}
      {isSurvey && url && entry.status === 'applied' && (
        <SurveyCompletionForm userId={userId} testId={entry.test_id} />
      )}
      {!isSurvey && open && entry.status === 'applied' && (
        <form
          className="flow"
          onSubmit={(event) => {
            event.preventDefault()
            if (!submit.isPending && length >= 10 && length <= 3000)
              submit.mutate({ id: entry.test_id, feedback: feedback.trim() })
          }}
        >
          <Field
            id={feedbackId}
            label="피드백"
            hint="피드백은 진행자에게만 전달됩니다. 개인정보는 쓰지 마세요."
          >
            <textarea
              id={feedbackId}
              className="input"
              rows={4}
              maxLength={3000}
              required
              aria-describedby={`${feedbackId}-help`}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={submit.isPending || length < 10 || length > 3000}>
            {submit.isPending ? '제출 중…' : '피드백 제출'}
          </Button>
        </form>
      )}
      {submit.error && (
        <ResearchAccountError
          error={submit.error}
          fallback="피드백을 제출하지 못했습니다. 잠시 후 다시 시도해 주세요."
          next="/research/mine"
        />
      )}
    </article>
  )
}

function SurveyCompletionForm({ userId, testId }: { userId: string; testId: string }) {
  const [attested, setAttested] = useState(false)
  const submit = useResearchMutation(userId, submitSurveyCompletion)

  return (
    <form
      className="flow"
      onSubmit={(event) => {
        event.preventDefault()
        if (attested && !submit.isPending) submit.mutate(testId)
      }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          required
          checked={attested}
          disabled={submit.isPending}
          onChange={(event) => setAttested(event.target.checked)}
        />
        외부 폼에서 응답을 제출했습니다.
      </label>
      <p className="muted text-sm">진행자가 응답 완료를 확인한 뒤 크레딧을 지급합니다.</p>
      <Button type="submit" disabled={!attested || submit.isPending}>
        {submit.isPending ? '보내는 중…' : '응답 완료 알리기'}
      </Button>
      {submit.error && (
        <ResearchAccountError
          error={submit.error}
          fallback="응답 완료를 알리지 못했습니다."
          next="/research/mine"
        />
      )}
    </form>
  )
}

function OrganizerCard({
  test,
  userId,
}: {
  test: ResearchWork['organized'][number]
  userId: string
}) {
  const confirm = useResearchMutation(userId, confirmResearchParticipation)
  const reject = useResearchMutation(userId, rejectSurveyCompletion)
  const close = useResearchMutation(userId, closeResearchTest)
  const busy = confirm.isPending || reject.isPending || close.isPending
  const [confirmClose, setConfirmClose] = useState(false)
  const pendingCompletion = test.participants.some((entry) => entry.status === 'submitted')
  const hasCodeToCheck = test.participants.some(
    (entry) => entry.status === 'submitted' && entry.confirmation_code,
  )
  const isSurvey = test.kind === 'survey'
  const open = test.status === 'open'
  return (
    <article className="panel flow">
      {isSurvey && <p className="muted text-sm">외부 설문</p>}
      <h3>{test.title}</h3>
      <p className="muted">
        {open ? '모집 중' : '모집 종료'} · 신청 {test.capacity - test.slots_left}/{test.capacity}명
        · 예약 {test.reserved_remaining} 크레딧
      </p>
      {isSurvey && pendingCompletion && (
        <p className="muted text-sm">
          {hasCodeToCheck
            ? '외부 폼에서 해당 참여의 확인 코드를 직접 대조한 뒤 보상을 지급하세요. '
            : '외부 폼에서 응답을 확인한 뒤 보상을 지급하세요. '}
          확인할 수 없는 신고는 거절할 수 있으며, 해당 보상은 모집 종료 시 환급됩니다.
        </p>
      )}
      {test.participants.length ? (
        <ul className="research-items divided-list">
          {test.participants.map((entry) => (
            <li className="split-row" key={entry.id}>
              <div className="flow">
                <strong>{entry.nickname ?? '참여자'}</strong>
                <span className="muted">
                  {!open && entry.status === 'applied'
                    ? '미제출 · 보상 없음'
                    : isSurvey && entry.status === 'submitted'
                      ? '응답 완료 신고 · 확인 대기'
                      : statuses[entry.status]}
                </span>
                {entry.feedback && <p className="research-text">{entry.feedback}</p>}
                {isSurvey && entry.confirmation_code && (
                  <p className="research-text">
                    참여 확인 코드: <code>{entry.confirmation_code}</code>
                  </p>
                )}
              </div>
              {open && entry.status === 'submitted' && (
                <div className="research-nav">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      reject.reset()
                      confirm.mutate(entry.id)
                    }}
                  >
                    {confirm.isPending && confirm.variables === entry.id
                      ? '지급 중…'
                      : `${test.reward} 크레딧 지급`}
                  </Button>
                  {isSurvey && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        confirm.reset()
                        reject.mutate(entry.id)
                      }}
                    >
                      {reject.isPending && reject.variables === entry.id
                        ? '거절 중…'
                        : '응답 완료 거절'}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">아직 신청자가 없습니다.</p>
      )}
      {confirm.error && (
        <ResearchAccountError
          error={confirm.error}
          fallback="보상을 지급하지 못했습니다."
          next="/research/mine"
        />
      )}
      {reject.error && (
        <ResearchAccountError
          error={reject.error}
          fallback="응답 완료를 거절하지 못했습니다."
          next="/research/mine"
        />
      )}
      {close.error && (
        <ResearchAccountError
          error={close.error}
          fallback="모집을 종료하지 못했습니다."
          next="/research/mine"
        />
      )}
      {open &&
        (pendingCompletion ? (
          <p className="muted">
            {isSurvey
              ? '확인 대기 중인 신고에 보상을 지급하거나 거절한 뒤 종료할 수 있습니다.'
              : '제출된 피드백에 보상을 지급한 뒤 종료할 수 있습니다.'}
          </p>
        ) : confirmClose ? (
          <div className="flow">
            <Notice>
              종료하면 신청자는 더 이상 {isSurvey ? '응답 완료를 알릴' : '피드백을 제출할'} 수 없고,
              남은 예약 크레딧은 환급됩니다.
            </Notice>
            <div className="research-nav">
              <Button variant="danger" disabled={busy} onClick={() => close.mutate(test.id)}>
                {close.isPending ? '종료 중…' : '종료하고 환급'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  close.reset()
                  setConfirmClose(false)
                }}
              >
                취소
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setConfirmClose(true)} disabled={busy}>
            모집 종료
          </Button>
        ))}
    </article>
  )
}

export function ResearchCreditsPage({ userId }: { userId: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const credits = useResearchCredits(userId, cursors.at(-1))
  if (credits.isPending) return <Loading />
  if (credits.isError)
    return (
      <ResearchAccountError
        error={credits.error}
        fallback="크레딧을 불러오지 못했습니다."
        next="/research/credits"
        retry={() => void credits.refetch()}
      />
    )
  const { available, reserved, entries, next_before } = credits.data
  const signed = (value: number) => (value > 0 ? `+${value}` : String(value))
  return (
    <section className="panel flow" aria-label="본인 크레딧 원장">
      <p>
        사용 가능 <strong>{available} 크레딧</strong> · 예약 중 <strong>{reserved} 크레딧</strong>
      </p>
      <p className="muted">
        처음 이용할 때 3 크레딧을 한 번 지급합니다. 크레딧은 서비스 안에서만 쓸 수 있고 현금으로
        바꿀 수 없습니다.
      </p>
      <h2>거래 내역</h2>
      {entries.length ? (
        <ul className="research-items divided-list">
          {entries.map((item) => (
            <li className="split-row" key={item.sequence}>
              <div>
                <strong>{ledgerLabels[item.kind]}</strong>
                {item.test_title && <p className="research-text muted">{item.test_title}</p>}
              </div>
              <div>
                <p>
                  사용 가능 {signed(item.available_delta)} · 예약 {signed(item.reserved_delta)}
                </p>
                <time className="muted" dateTime={item.created_at}>
                  {dateFormat.format(new Date(item.created_at))}
                </time>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">표시할 거래가 없습니다.</p>
      )}
      {(cursors.length > 0 || next_before) && (
        <div className="research-nav">
          <Button
            variant="outline"
            disabled={!cursors.length}
            onClick={() => setCursors((items) => items.slice(0, -1))}
          >
            이전 내역
          </Button>
          <Button
            variant="outline"
            disabled={!next_before}
            onClick={() => {
              if (next_before) setCursors((items) => [...items, next_before])
            }}
          >
            다음 내역
          </Button>
        </div>
      )}
    </section>
  )
}
