import { Link, NavLink, useParams } from 'react-router'
import { Loading, Notice, PageHeading, Unconfigured } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { AuthVerificationError } from '../auth/AuthVerificationError'
import { useAuth } from '../auth/auth-provider'
import { ResearchPublishForm } from './ResearchPublishForm'
import { ResearchWorkPage, ResearchCreditsPage, ResearchAccountError } from './ResearchWork'
import {
  applyResearchTest,
  useResearchMutation,
  useResearchTests,
  useResearchWork,
  type ResearchPath,
} from './research-api'
import './research.css'

const routes = {
  '': { title: '리서치 풀', next: '/research' },
  new: { title: '리서치 모집 등록', next: '/research/new' },
  mine: { title: '내 리서치', next: '/research/mine' },
  credits: { title: '내 크레딧', next: '/research/credits' },
} as const

export function ResearchPage() {
  const { '*': relativePath = '' } = useParams()
  const path = relativePath.replace(/\/+$/, '')
  const { session, loading, status } = useAuth()
  const user = session?.user
  const route = Object.hasOwn(routes, path) ? routes[path as keyof typeof routes] : undefined

  return (
    <main className="narrow page" id="main-content">
      <PageHeading
        label="캠퍼스 리서치"
        title={route?.title ?? '페이지를 찾을 수 없어요'}
        description={
          path === '' ? '프로젝트 테스트나 설문에 참여하고 비금전 크레딧을 모으세요.' : undefined
        }
      />
      <nav className="research-nav" aria-label="리서치 메뉴">
        <NavLink to="/research" end>
          공개 모집
        </NavLink>
        {user && (
          <>
            <NavLink to="/research/new">모집 등록</NavLink>
            <NavLink to="/research/mine">내 리서치</NavLink>
            <NavLink to="/research/credits">내 크레딧</NavLink>
          </>
        )}
      </nav>
      {!route ? (
        <Notice>리서치 메뉴에서 페이지를 선택해 주세요.</Notice>
      ) : !isSupabaseConfigured ? (
        <Unconfigured />
      ) : path === '' ? (
        <ResearchList key={user?.id ?? 'guest'} userId={user?.id} checkingSession={loading} />
      ) : loading ? (
        <Loading label="로그인 상태 확인 중…" />
      ) : status === 'error' ? (
        <AuthVerificationError />
      ) : !user ? (
        <ResearchLogin next={route.next} />
      ) : path === 'new' ? (
        <ResearchPublishForm key={user.id} userId={user.id} />
      ) : path === 'mine' ? (
        <ResearchWorkPage key={user.id} userId={user.id} />
      ) : (
        <ResearchCreditsPage key={user.id} userId={user.id} />
      )}
    </main>
  )
}

function ResearchLogin({ next }: { next: ResearchPath }) {
  return (
    <Notice>
      참여와 모집 등록은 학교 Google 계정으로{' '}
      <Link className="text-link" to="/login" state={{ next }}>
        로그인
      </Link>
      한 뒤 이용할 수 있습니다.
    </Notice>
  )
}

function ResearchList({ userId, checkingSession }: { userId?: string; checkingSession: boolean }) {
  const tests = useResearchTests()
  const work = useResearchWork(userId)
  const apply = useResearchMutation(userId ?? '', applyResearchTest)
  const organized = new Set(work.data?.organized.map(({ id }) => id))
  const participating = new Set(work.data?.participating.map(({ test_id }) => test_id))

  return (
    <section className="flow" aria-label="모집 중인 리서치">
      {!userId && !checkingSession && <ResearchLogin next="/research" />}
      {userId && work.isError && (
        <ResearchAccountError
          error={work.error}
          fallback="참여 상태를 불러오지 못했습니다."
          next="/research"
          retry={() => void work.refetch()}
        />
      )}
      {apply.isSuccess && (
        <Notice kind="success">
          신청했습니다.{' '}
          <Link className="text-link" to="/research/mine">
            내 리서치
          </Link>
          에서 참여 안내를 확인하세요.
        </Notice>
      )}
      {apply.error && (
        <ResearchAccountError
          error={apply.error}
          fallback="신청하지 못했습니다. 잠시 후 다시 시도해 주세요."
          next="/research"
        />
      )}
      {tests.isPending ? (
        <Loading />
      ) : tests.isError ? (
        <Notice kind="error">
          공개 모집을 불러오지 못했습니다.{' '}
          <button className="text-link" type="button" onClick={() => void tests.refetch()}>
            다시 시도
          </button>
        </Notice>
      ) : tests.data.length === 0 ? (
        <Notice>지금 모집 중인 리서치가 없습니다.</Notice>
      ) : (
        <ul className="research-items divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {tests.data.map((test) => (
            <li key={test.id}>
              <article className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="grid min-w-0 gap-1">
                  <p className="muted text-sm">
                    {test.kind === 'survey' ? '외부 설문' : '프로젝트 테스트'}
                  </p>
                  <h2 className="research-text">{test.title}</h2>
                  <p className="research-text">{test.description}</p>
                  <p className="muted text-sm">
                    남은 자리 {test.slots_left}/{test.capacity} · 참여 보상 {test.reward} 크레딧
                  </p>
                </div>
                {userId &&
                  !work.isError &&
                  work.data &&
                  (organized.has(test.id) ? (
                    <span className="muted">내가 진행하는 모집</span>
                  ) : participating.has(test.id) ? (
                    <Link className="text-link justify-self-start" to="/research/mine">
                      참여 내역 보기
                    </Link>
                  ) : test.slots_left === 0 ? (
                    <span className="muted">정원 마감</span>
                  ) : (
                    <Button
                      className="justify-self-start"
                      disabled={apply.isPending}
                      onClick={() => apply.mutate(test.id)}
                    >
                      {apply.isPending && apply.variables === test.id ? '신청 중…' : '참여 신청'}
                    </Button>
                  ))}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
