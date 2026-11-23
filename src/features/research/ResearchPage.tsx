import { Link, NavLink, useParams } from 'react-router'
import { Loading, Notice, PageHeading, Unconfigured } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../auth/auth-provider'
import { SchoolVerification } from '../universities/SchoolVerification'
import { ResearchPublishForm } from './ResearchPublishForm'
import { ResearchWorkPage, ResearchCreditsPage, ResearchAccountError } from './ResearchWork'
import {
  applyResearchTest,
  researchError,
  useResearchMutation,
  useResearchTests,
  useResearchWork,
} from './research-api'
import './research.css'

const titles = {
  '': '리서치 풀',
  new: '테스트 모집 등록',
  mine: '내 리서치',
  credits: '내 크레딧',
} as const

export function ResearchPage() {
  const { '*': relativePath = '' } = useParams()
  const path = relativePath.replace(/\/+$/, '')
  const { session, loading } = useAuth()
  const user = session?.user
  const title = Object.hasOwn(titles, path) ? titles[path as keyof typeof titles] : undefined

  return (
    <main className="narrow page" id="main-content">
      <PageHeading
        label="캠퍼스 리서치"
        title={title ?? '페이지를 찾을 수 없어요'}
        description={
          path === ''
            ? '프로젝트 테스트에 참여해 피드백을 나누고 비금전 크레딧을 모으세요.'
            : undefined
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
      {!title ? (
        <Notice>리서치 메뉴에서 페이지를 선택해 주세요.</Notice>
      ) : !isSupabaseConfigured ? (
        <Unconfigured />
      ) : path === '' ? (
        <ResearchList key={user?.id ?? 'guest'} userId={user?.id} checkingSession={loading} />
      ) : loading ? (
        <Loading label="로그인 상태 확인 중…" />
      ) : !user ? (
        <ResearchLogin />
      ) : (
        <SchoolVerification key={user.id} userId={user.id} email={user.email}>
          {path === 'new' ? (
            <ResearchPublishForm userId={user.id} />
          ) : path === 'mine' ? (
            <ResearchWorkPage userId={user.id} />
          ) : (
            <ResearchCreditsPage userId={user.id} />
          )}
        </SchoolVerification>
      )}
    </main>
  )
}

function ResearchLogin() {
  return (
    <Notice>
      참여와 모집 등록은 학교 Google 계정으로{' '}
      <Link className="text-link" to="/login">
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
    <section className="flow" aria-label="모집 중인 테스트">
      {!userId && !checkingSession && <ResearchLogin />}
      {userId && work.isError && (
        <ResearchAccountError
          error={work.error}
          fallback="참여 상태를 불러오지 못했습니다."
          retry={() => void work.refetch()}
        />
      )}
      {apply.isSuccess && (
        <Notice kind="success">
          신청했습니다.{' '}
          <Link className="text-link" to="/research/mine">
            내 리서치
          </Link>
          에서 테스트를 열고 피드백을 제출하세요.
        </Notice>
      )}
      {apply.error && (
        <Notice kind="error">
          {researchError(apply.error, '신청하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
        </Notice>
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
        <Notice>지금 모집 중인 테스트가 없습니다.</Notice>
      ) : (
        tests.data.map((test) => (
          <article className="panel flow" key={test.id}>
            <h2>{test.title}</h2>
            <p className="research-text">{test.description}</p>
            <p className="muted">
              남은 자리 {test.slots_left}/{test.capacity} · 참여 보상 {test.reward} 크레딧
            </p>
            {userId &&
              !work.isError &&
              work.data &&
              (organized.has(test.id) ? (
                <span className="muted">내가 진행하는 테스트</span>
              ) : participating.has(test.id) ? (
                <Link className="text-link" to="/research/mine">
                  참여 내역 보기
                </Link>
              ) : test.slots_left === 0 ? (
                <span className="muted">정원 마감</span>
              ) : (
                <Button disabled={apply.isPending} onClick={() => apply.mutate(test.id)}>
                  {apply.isPending && apply.variables === test.id ? '신청 중…' : '참여 신청'}
                </Button>
              ))}
          </article>
        ))
      )}
    </section>
  )
}
