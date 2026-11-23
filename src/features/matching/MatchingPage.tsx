import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { Field, Loading, Notice, PageHeading, Unconfigured } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { useAuth } from '../auth/auth-provider'
import { myProjectsKey } from '../projects/project-api'
import { FormatOptions, LocalTime, Paging, QueryFailure, UniversityField } from './MatchingFields'
import { ApplyForm, PublishForm } from './MatchingForms'
import {
  closeOpportunity,
  decideRequest,
  emptyFilters,
  formatLabels,
  listOpportunities,
  listRequests,
  matchingError,
  matchingKey,
  matchingPageSize,
  opportunityLabels,
  statusLabels,
  type MatchingRequest,
  type Opportunity,
  type OpportunityType,
  type RebootAttachment,
} from './matching-api'
import { downloadRebootAttachment } from './reboot-attachments'

const sections = [
  { path: '/opportunities', label: '전체 모집', type: null },
  { path: '/opportunities/ideas', label: opportunityLabels.idea, type: 'idea' },
  { path: '/opportunities/reboots', label: opportunityLabels.reboot, type: 'reboot' },
  { path: '/opportunities/contests', label: opportunityLabels.contest, type: 'contest' },
  { path: '/opportunities/new', label: '모집글 등록', type: null },
  { path: '/opportunities/mine', label: '내 모집글', type: null },
  { path: '/opportunities/requests', label: '지원 내역', type: null },
] as const

export function MatchingPage() {
  const { session, loading } = useAuth()
  const location = useLocation()
  return (
    <main className="container page" id="main-content">
      <PageHeading
        label="협업 매칭"
        title="함께할 팀원을 찾아요"
        description="미완성 아이디어를 키우고, 멈춘 프로젝트를 다시 시작하거나, 공모전 팀을 꾸려 보세요."
      />
      {!isSupabaseConfigured ? (
        <Unconfigured />
      ) : loading ? (
        <Loading label="로그인 상태 확인 중…" />
      ) : !session ? (
        <Notice>
          학교에서 발급한 Google 계정으로{' '}
          <Link className="text-link" to="/login" state={{ next: location.pathname }}>
            로그인
          </Link>
          하면 매칭을 이용할 수 있습니다.
        </Notice>
      ) : (
        <Workspace key={session.user.id} userId={session.user.id} />
      )}
    </main>
  )
}

function Workspace({ userId }: { userId: string }) {
  const { pathname, state } = useLocation()
  const navigate = useNavigate()
  const view =
    sections.find((section) => section.path === pathname.replace(/\/$/, '')) ?? sections[0]
  return (
    <div className="workspace-grid">
      <nav className="workspace-nav" aria-label="협업 매칭 메뉴">
        {sections.map((section) => (
          <NavLink key={section.path} to={section.path} end>
            {section.label}
          </NavLink>
        ))}
      </nav>
      {view.path === '/opportunities/new' ? (
        <PublishForm
          userId={userId}
          onPublished={() => void navigate('/opportunities/mine', { state: { published: true } })}
        />
      ) : view.path === '/opportunities/requests' ? (
        <Requests userId={userId} />
      ) : (
        <Board
          key={view.path}
          userId={userId}
          type={view.type}
          label={view.label}
          mine={view.path === '/opportunities/mine'}
          published={state?.published === true}
        />
      )}
    </div>
  )
}

function Board({
  userId,
  type,
  label,
  mine,
  published,
}: {
  userId: string
  type: OpportunityType | null
  label: string
  mine: boolean
  published: boolean
}) {
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(0)
  const cache = useQueryClient()
  const board = useQuery({
    queryKey: [...matchingKey(userId), 'board', mine, type, filters, page],
    queryFn: () => listOpportunities(type, filters, page, mine),
  })
  const refresh = () => cache.invalidateQueries({ queryKey: matchingKey(userId) })
  return (
    <section className="flow" aria-label={label}>
      <div className="section-heading">
        <h2>{label}</h2>
        <Button asChild>
          <Link to={mine ? '/opportunities/requests' : '/opportunities/new'}>
            {mine ? '지원 내역 보기' : '새 모집글'}
          </Link>
        </Button>
      </div>
      {mine && published && <Notice kind="success">모집글을 등록했습니다.</Notice>}
      {!mine && (
        <form
          className="panel flow"
          aria-label="모집 조건 검색"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const value = (key: string) => String(form.get(key) ?? '').trim()
            const next = {
              university: value('university'),
              major: value('major'),
              skill: value('skill'),
              role: value('role'),
              competition: value('competition'),
              format: value('format'),
            }
            setFilters(next)
            setPage(0)
            if (
              page === 0 &&
              Object.keys(next).every(
                (key) => next[key as keyof typeof next] === filters[key as keyof typeof filters],
              )
            )
              void board.refetch()
          }}
        >
          <div className="form-grid">
            <UniversityField id="filter-university" />
            <Field id="filter-major" label="전공">
              <input id="filter-major" name="major" className="input" maxLength={80} />
            </Field>
            <Field id="filter-skill" label="역량">
              <input id="filter-skill" name="skill" className="input" maxLength={40} />
            </Field>
            <Field id="filter-role" label="역할">
              <input id="filter-role" name="role" className="input" maxLength={40} />
            </Field>
            {(!type || type === 'contest') && (
              <>
                <Field id="filter-competition" label="공모전 이름">
                  <input
                    id="filter-competition"
                    name="competition"
                    className="input"
                    maxLength={100}
                  />
                </Field>
                <Field id="filter-format" label="진행 형식">
                  <select id="filter-format" name="format" className="input">
                    <option value="">모든 형식</option>
                    <FormatOptions />
                  </select>
                </Field>
              </>
            )}
          </div>
          <div className="wrap">
            <Button type="submit" variant="outline">
              검색
            </Button>
            <Button
              type="reset"
              variant="ghost"
              onClick={() => {
                setFilters(emptyFilters)
                setPage(0)
              }}
            >
              초기화
            </Button>
          </div>
        </form>
      )}
      {board.isPending ? (
        <Loading label="모집글을 불러오는 중…" />
      ) : board.isError ? (
        <QueryFailure
          error={board.error}
          fallback="모집글을 불러오지 못했습니다."
          retry={board.refetch}
        />
      ) : (
        <>
          {board.data.length === 0 ? (
            <div className="panel empty-state">
              <p>{mine ? '아직 올린 모집글이 없어요.' : '조건에 맞는 모집글이 없어요.'}</p>
            </div>
          ) : (
            <ul className="flow">
              {board.data.slice(0, matchingPageSize).map((item) => (
                <OpportunityCard item={item} onUpdate={refresh} key={item.id} />
              ))}
            </ul>
          )}
          <Paging page={page} count={board.data.length} onChange={setPage} />
        </>
      )}
    </section>
  )
}

function OpportunityCard({
  item,
  onUpdate,
}: {
  item: Opportunity
  onUpdate: () => Promise<unknown>
}) {
  const [applying, setApplying] = useState(false)
  const close = useMutation({ mutationFn: () => closeOpportunity(item.id), onSuccess: onUpdate })
  return (
    <li className="panel flow">
      <div className="wrap">
        <span className="chip chip-primary">{opportunityLabels[item.type]}</span>
        {item.is_mine && <span className="chip">내 글</span>}
        {!item.is_open && <span className="chip">지원 마감</span>}
      </div>
      <h3>{item.title}</h3>
      <p className="preserve-text">{item.description}</p>
      {item.gap && (
        <p className="preserve-text">
          <strong>함께 해결할 부분:</strong> {item.gap}
        </p>
      )}
      {item.type === 'reboot' && (
        <>
          {item.reboot_prior_work && (
            <div>
              <strong>이전까지 해 둔 작업</strong>
              <p className="preserve-text">{item.reboot_prior_work}</p>
            </div>
          )}
          {item.reboot_changes && (
            <div>
              <strong>멈춘 이유와 바꿀 점</strong>
              <p className="preserve-text">{item.reboot_changes}</p>
            </div>
          )}
          {item.reboot_attachment && <RebootDownload attachment={item.reboot_attachment} />}
          {item.source_project_id && (
            <Link className="text-link" to={`/projects/${item.source_project_id}`}>
              공개 원본 보기
            </Link>
          )}
        </>
      )}
      {item.competition && (
        <p>
          <strong>공모전:</strong> {item.competition}
          {item.format && ` · ${formatLabels[item.format]}`}
          {item.deadline && (
            <>
              {' '}
              · 마감 <LocalTime value={item.deadline} />
            </>
          )}
        </p>
      )}
      <div className="project-details">
        <div>
          <strong>모집 역할</strong>
          <p>{item.roles.join(', ')}</p>
        </div>
        {item.skills.length > 0 && (
          <div>
            <strong>필요 역량</strong>
            <p>{item.skills.join(', ')}</p>
          </div>
        )}
        {(item.university_name || item.major) && (
          <div>
            <strong>모집 대상</strong>
            <p>{[item.university_name, item.major].filter(Boolean).join(' · ')}</p>
          </div>
        )}
      </div>
      {close.isError && (
        <Notice kind="error">{matchingError(close.error, '모집을 마감하지 못했습니다.')}</Notice>
      )}
      {applying && item.is_open && !item.is_mine && !item.request_status && (
        <ApplyForm item={item} onApplied={onUpdate} onCancel={() => setApplying(false)} />
      )}
      <div className="wrap">
        {item.project_id && (
          <Button asChild variant="outline">
            <Link to={`/projects/${item.project_id}`}>팀 프로젝트 열기</Link>
          </Button>
        )}
        {item.request_status && (
          <span className="chip" role="status">
            {statusLabels[item.request_status]}
          </span>
        )}
        {item.is_mine && item.is_open && (
          <Button
            variant="outline"
            type="button"
            disabled={close.isPending}
            onClick={() => close.mutate()}
          >
            {close.isPending ? '마감하는 중…' : '모집 마감'}
          </Button>
        )}
        {!item.is_mine && item.is_open && !item.request_status && !applying && (
          <Button type="button" onClick={() => setApplying(true)}>
            지원하기
          </Button>
        )}
      </div>
    </li>
  )
}

function RebootDownload({ attachment }: { attachment: RebootAttachment }) {
  const download = useMutation({ mutationFn: () => downloadRebootAttachment(attachment) })
  return (
    <div className="flow">
      <div className="wrap">
        <Button
          type="button"
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {download.isPending ? '다운로드 중…' : `${attachment.filename} 다운로드`}
        </Button>
        <span className="muted">
          {new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(
            attachment.size / 1024,
          )}{' '}
          KB
        </span>
      </div>
      {download.isError && <Notice kind="error">첨부 파일을 내려받지 못했습니다.</Notice>}
    </div>
  )
}

function Requests({ userId }: { userId: string }) {
  const [received, setReceived] = useState(false)
  const [page, setPage] = useState(0)
  const requests = useQuery({
    queryKey: [...matchingKey(userId), 'requests', received, page],
    queryFn: () => listRequests(received, page),
  })
  return (
    <section className="flow" aria-label="지원 내역">
      <h2>지원 내역</h2>
      <div className="wrap">
        <Button
          type="button"
          variant={received ? 'outline' : 'primary'}
          aria-pressed={!received}
          onClick={() => {
            setReceived(false)
            setPage(0)
          }}
        >
          보낸 지원
        </Button>
        <Button
          type="button"
          variant={received ? 'primary' : 'outline'}
          aria-pressed={received}
          onClick={() => {
            setReceived(true)
            setPage(0)
          }}
        >
          받은 지원
        </Button>
      </div>
      {received && (
        <p className="muted">
          첫 지원을 수락하면 새 비공개 프로젝트가 만들어지며, 이후 수락한 팀원도 같은 프로젝트에
          합류합니다.
        </p>
      )}
      {requests.isPending ? (
        <Loading label="지원 내역을 불러오는 중…" />
      ) : requests.isError ? (
        <QueryFailure
          error={requests.error}
          fallback="지원 내역을 불러오지 못했습니다."
          retry={requests.refetch}
        />
      ) : (
        <>
          {requests.data.length === 0 ? (
            <div className="panel empty-state">
              <p>{received ? '아직 받은 지원이 없어요.' : '아직 보낸 지원이 없어요.'}</p>
            </div>
          ) : (
            <ul className="flow">
              {requests.data.slice(0, matchingPageSize).map((request) => (
                <RequestCard
                  userId={userId}
                  received={received}
                  key={request.id}
                  request={request}
                />
              ))}
            </ul>
          )}
          <Paging page={page} count={requests.data.length} onChange={setPage} />
        </>
      )}
    </section>
  )
}

function RequestCard({
  userId,
  request,
  received,
}: {
  userId: string
  request: MatchingRequest
  received: boolean
}) {
  const cache = useQueryClient()
  const decide = useMutation({
    mutationFn: (accept: boolean) => decideRequest(request.id, accept),
    onSuccess: (projectId) =>
      Promise.all([
        cache.invalidateQueries({ queryKey: matchingKey(userId) }),
        ...(projectId ? [cache.invalidateQueries({ queryKey: myProjectsKey(userId) })] : []),
      ]),
  })
  return (
    <li className="panel flow">
      <div className="wrap">
        <span className="chip chip-primary">{opportunityLabels[request.type]}</span>
        <span className="chip" role="status">
          {statusLabels[request.status]}
        </span>
      </div>
      <h3>{request.opportunity_title}</h3>
      <p className="muted">
        {received && <>{request.applicant_nickname ?? '닉네임 없음'} · </>}
        <LocalTime value={request.created_at} />
      </p>
      <p className="preserve-text">{request.message}</p>
      {(request.selected_role || request.timezone) && (
        <p className="muted">
          {[request.selected_role, request.timezone].filter(Boolean).join(' · ')}
        </p>
      )}
      {decide.isError && (
        <Notice kind="error">{matchingError(decide.error, '지원을 처리하지 못했습니다.')}</Notice>
      )}
      {received && request.status === 'pending' && (
        <div className="wrap">
          <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
            {decide.isPending && decide.variables ? '수락하는 중…' : '수락'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate(false)}
          >
            {decide.isPending && !decide.variables ? '거절하는 중…' : '거절'}
          </Button>
        </div>
      )}
      {request.project_id && (
        <Button asChild variant="outline">
          <Link to={`/projects/${request.project_id}`}>팀 프로젝트 열기</Link>
        </Button>
      )}
    </li>
  )
}
