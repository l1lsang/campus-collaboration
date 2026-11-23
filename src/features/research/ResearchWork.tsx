import { useId, useState } from 'react'
import { Link } from 'react-router'
import { Field, Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import {
  closeResearchTest,
  confirmResearchParticipation,
  researchError,
  safeTestUrl,
  submitResearchFeedback,
  useResearchCredits,
  useResearchMutation,
  useResearchWork,
  type CreditLedger,
  type ResearchWork,
} from './research-api'

const statuses = {
  applied: '신청 완료',
  submitted: '피드백 제출 · 확인 대기',
  confirmed: '보상 지급 완료',
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
  retry,
}: {
  error: unknown
  fallback: string
  retry: () => void
}) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : null
  return (
    <Notice kind="error">
      {researchError(error, fallback)}{' '}
      {message === 'PROFILE_REQUIRED' ? (
        <Link className="text-link" to="/onboarding">
          프로필 작성
        </Link>
      ) : message === 'VERIFIED_UNIVERSITY_REQUIRED' ? (
        <Link className="text-link" to="/login">
          학교 Google로 로그인
        </Link>
      ) : (
        <button className="text-link" type="button" onClick={retry}>
          다시 시도
        </button>
      )}
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
        retry={() => void work.refetch()}
      />
    )

  return (
    <div className="flow">
      <section className="flow" aria-labelledby="research-participating">
        <h2 id="research-participating">참여한 테스트</h2>
        {!work.data.participating.length && <Notice>참여한 테스트가 없습니다.</Notice>}
        {work.data.participating.map((entry) => (
          <ParticipationCard key={entry.id} entry={entry} userId={userId} />
        ))}
      </section>
      <section className="flow" aria-labelledby="research-organized">
        <h2 id="research-organized">진행하는 테스트</h2>
        {!work.data.organized.length && <Notice>진행하는 테스트가 없습니다.</Notice>}
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
  const open = entry.test_status === 'open'
  const url = open ? safeTestUrl(entry.test_url) : null
  const length = Array.from(feedback.trim()).length
  const status =
    !open && entry.status === 'applied' ? '모집 종료 · 보상 없음' : statuses[entry.status]
  return (
    <article className="panel flow">
      <h3>{entry.title}</h3>
      <p className="muted">
        {status} · 참여 보상 {entry.reward} 크레딧
      </p>
      <p className="research-text">{entry.description}</p>
      {url && (
        <Button asChild variant="outline">
          <a href={url} target="_blank" rel="noopener noreferrer">
            테스트 열기
          </a>
        </Button>
      )}
      {open && !url && <Notice>이 테스트의 주소를 열 수 없습니다.</Notice>}
      {open && entry.status === 'applied' && (
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
        <Notice kind="error">
          {researchError(submit.error, '피드백을 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
        </Notice>
      )}
    </article>
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
  const close = useResearchMutation(userId, closeResearchTest)
  const [confirmClose, setConfirmClose] = useState(false)
  const pendingFeedback = test.participants.some((entry) => entry.status === 'submitted')
  const open = test.status === 'open'
  return (
    <article className="panel flow">
      <h3>{test.title}</h3>
      <p className="muted">
        {open ? '모집 중' : '모집 종료'} · 신청 {test.capacity - test.slots_left}/{test.capacity}명
        · 예약 {test.reserved_remaining} 크레딧
      </p>
      {test.participants.length ? (
        <ul className="research-items divided-list">
          {test.participants.map((entry) => (
            <li className="split-row" key={entry.id}>
              <div className="flow">
                <strong>{entry.nickname ?? '참여자'}</strong>
                <span className="muted">
                  {!open && entry.status === 'applied'
                    ? '미제출 · 보상 없음'
                    : statuses[entry.status]}
                </span>
                {entry.feedback && <p className="research-text">{entry.feedback}</p>}
              </div>
              {open && entry.status === 'submitted' && (
                <Button
                  variant="outline"
                  disabled={confirm.isPending || close.isPending}
                  onClick={() => confirm.mutate(entry.id)}
                >
                  {confirm.isPending && confirm.variables === entry.id
                    ? '지급 중…'
                    : `${test.reward} 크레딧 지급`}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">아직 신청자가 없습니다.</p>
      )}
      {confirm.error && (
        <Notice kind="error">{researchError(confirm.error, '보상을 지급하지 못했습니다.')}</Notice>
      )}
      {close.error && (
        <Notice kind="error">{researchError(close.error, '모집을 종료하지 못했습니다.')}</Notice>
      )}
      {open &&
        (pendingFeedback ? (
          <p className="muted">제출된 피드백에 보상을 지급한 뒤 종료할 수 있습니다.</p>
        ) : confirmClose ? (
          <div className="flow">
            <Notice>
              종료하면 신청자가 더 이상 피드백을 제출할 수 없고, 남은 예약 크레딧은 환급됩니다.
            </Notice>
            <div className="research-nav">
              <Button
                variant="danger"
                disabled={close.isPending}
                onClick={() => close.mutate(test.id)}
              >
                {close.isPending ? '종료 중…' : '종료하고 환급'}
              </Button>
              <Button
                variant="outline"
                disabled={close.isPending}
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
          <Button
            variant="outline"
            onClick={() => setConfirmClose(true)}
            disabled={confirm.isPending}
          >
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
