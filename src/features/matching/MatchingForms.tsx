import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Field, Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { FormatOptions, Paging, QueryFailure, UniversityField } from './MatchingFields'
import {
  createOpportunity,
  listRebootSources,
  matchingError,
  matchingKey,
  matchingPageSize,
  opportunityLabels,
  submitOpportunity,
  type Opportunity,
  type OpportunityType,
} from './matching-api'

export function PublishForm({ userId, onPublished }: { userId: string; onPublished: () => void }) {
  const [type, setType] = useState<OpportunityType>('idea')
  const [sourceId, setSourceId] = useState('')
  const cache = useQueryClient()
  const publish = useMutation({
    mutationFn: (form: FormData) => createOpportunity(type, form),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: matchingKey(userId) })
      onPublished()
    },
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (publish.isPending || (type === 'reboot' && !sourceId)) return
    publish.mutate(new FormData(event.currentTarget))
  }

  return (
    <form className="panel flow" onSubmit={submit}>
      <h2>모집글 등록</h2>
      <p className="muted">
        모집글은 학교 Google 계정으로 로그인한 학생에게 표시됩니다. 연락처나 비공개 자료는 넣지
        마세요.
      </p>
      <fieldset className="flow" disabled={publish.isPending}>
        <Field id="matching-type" label="모집 유형">
          <select
            id="matching-type"
            className="input"
            value={type}
            onChange={(event) => {
              setType(event.target.value as OpportunityType)
              setSourceId('')
              publish.reset()
            }}
          >
            {Object.entries(opportunityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="matching-title" label="모집 제목">
          <input
            id="matching-title"
            name="title"
            className="input"
            required
            minLength={2}
            maxLength={100}
          />
        </Field>
        <Field id="matching-description" label="모집 소개">
          <textarea
            id="matching-description"
            name="description"
            className="input"
            rows={4}
            required
            minLength={10}
            maxLength={4000}
          />
        </Field>
        {type === 'idea' && (
          <Field id="matching-gap" label="함께 해결하고 싶은 부분">
            <textarea
              id="matching-gap"
              name="gap"
              className="input"
              rows={3}
              required
              minLength={2}
              maxLength={1000}
            />
          </Field>
        )}
        {type === 'reboot' && (
          <RebootSourcePicker userId={userId} sourceId={sourceId} onSelect={setSourceId} />
        )}
        {type === 'contest' && (
          <div className="form-grid">
            <Field id="matching-competition" label="공모전 이름">
              <input
                id="matching-competition"
                name="competition"
                className="input"
                required
                minLength={2}
                maxLength={100}
              />
            </Field>
            <Field id="matching-format" label="진행 형식">
              <select id="matching-format" name="format" className="input" required defaultValue="">
                <option value="">선택해 주세요</option>
                <FormatOptions />
              </select>
            </Field>
            <Field
              id="matching-deadline"
              label="지원 마감 일시"
              hint="이 기기의 시간대를 기준으로 입력해 주세요."
            >
              <input
                id="matching-deadline"
                name="deadline"
                className="input"
                type="datetime-local"
                required
                aria-describedby="matching-deadline-help"
              />
            </Field>
          </div>
        )}
        <div className="form-grid">
          <Field id="matching-roles" label="모집 역할" hint="쉼표로 구분해 최대 10개를 입력하세요.">
            <input
              id="matching-roles"
              name="roles"
              className="input"
              required
              maxLength={409}
              placeholder="개발, 디자인"
              aria-describedby="matching-roles-help"
            />
          </Field>
          <Field
            id="matching-skills"
            label="필요 역량 (선택)"
            hint="쉼표로 구분해 최대 10개를 입력하세요."
          >
            <input
              id="matching-skills"
              name="skills"
              className="input"
              maxLength={409}
              placeholder="React, Figma"
              aria-describedby="matching-skills-help"
            />
          </Field>
          <UniversityField id="matching-university" />
          <Field id="matching-major" label="대상 전공 (선택)">
            <input id="matching-major" name="major" className="input" maxLength={80} />
          </Field>
        </div>
      </fieldset>
      {publish.isError && (
        <Notice kind="error">
          {matchingError(publish.error, '모집글을 등록하지 못했습니다.')}
        </Notice>
      )}
      <Button type="submit" disabled={publish.isPending || (type === 'reboot' && !sourceId)}>
        {publish.isPending ? '등록하는 중…' : '모집글 올리기'}
      </Button>
    </form>
  )
}

function RebootSourcePicker({
  userId,
  sourceId,
  onSelect,
}: {
  userId: string
  sourceId: string
  onSelect: (id: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const sources = useQuery({
    queryKey: [...matchingKey(userId), 'sources', search, page],
    queryFn: () => listRebootSources(search, page),
  })
  const runSearch = () => {
    const next = draft.trim()
    if (next !== search || page !== 0) onSelect('')
    setSearch(next)
    setPage(0)
  }
  return (
    <div className="flow">
      <Field
        id="reboot-source-search"
        label="공개 원본 제목 검색"
        hint="원본은 링크만 표시하며, 내용이나 팀원을 복사하지 않습니다."
      >
        <input
          id="reboot-source-search"
          className="input"
          type="search"
          maxLength={100}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-describedby="reboot-source-search-help"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              runSearch()
            }
          }}
        />
      </Field>
      <Button type="button" variant="outline" onClick={runSearch}>
        원본 찾기
      </Button>
      {sources.isPending ? (
        <Loading label="리부트 원본을 불러오는 중…" />
      ) : sources.isError ? (
        <QueryFailure
          error={sources.error}
          fallback="리부트 원본을 불러오지 못했습니다."
          retry={sources.refetch}
        />
      ) : (
        <>
          <Field id="reboot-source" label="리부트할 공개 프로젝트">
            <select
              id="reboot-source"
              name="source_project"
              className="input"
              value={sourceId}
              onChange={(event) => onSelect(event.target.value)}
              required
            >
              <option value="">
                {sources.data.length ? '원본을 선택해 주세요' : '조건에 맞는 공개 원본이 없어요'}
              </option>
              {sources.data.slice(0, matchingPageSize).map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </select>
          </Field>
          <Paging
            page={page}
            count={sources.data.length}
            onChange={(nextPage) => {
              onSelect('')
              setPage(nextPage)
            }}
          />
        </>
      )}
    </div>
  )
}

export function ApplyForm({
  item,
  onApplied,
  onCancel,
}: {
  item: Opportunity
  onApplied: () => Promise<unknown>
  onCancel: () => void
}) {
  const id = useId()
  const apply = useMutation({
    mutationFn: (form: FormData) => submitOpportunity(item.id, form),
    onSuccess: onApplied,
  })
  return (
    <form
      className="flow"
      onSubmit={(event) => {
        event.preventDefault()
        if (!apply.isPending) apply.mutate(new FormData(event.currentTarget))
      }}
    >
      <fieldset className="flow" disabled={apply.isPending}>
        <Field
          id={`${id}-message`}
          label="지원 메시지"
          hint="닉네임과 지원서 정보는 모집글 작성자에게 전달됩니다."
        >
          <textarea
            id={`${id}-message`}
            name="message"
            className="input"
            required
            minLength={2}
            maxLength={2000}
            rows={3}
            aria-describedby={`${id}-message-help`}
          />
        </Field>
        <div className="form-grid">
          <Field id={`${id}-role`} label="희망 역할 (선택)">
            <select id={`${id}-role`} name="role" className="input">
              <option value="">아직 선택하지 않음</option>
              {item.roles.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-timezone`} label="활동 시간대 (선택)">
            <input
              id={`${id}-timezone`}
              name="timezone"
              className="input"
              placeholder="Asia/Seoul"
              maxLength={64}
            />
          </Field>
        </div>
      </fieldset>
      {apply.isError && (
        <Notice kind="error">{matchingError(apply.error, '지원을 보내지 못했습니다.')}</Notice>
      )}
      {apply.isSuccess && (
        <Notice kind="success">지원을 보냈습니다. 지원 내역에서 확인할 수 있어요.</Notice>
      )}
      <div className="wrap">
        {!apply.isSuccess && (
          <Button type="submit" disabled={apply.isPending}>
            {apply.isPending ? '보내는 중…' : '지원 보내기'}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={apply.isPending}>
          {apply.isSuccess ? '닫기' : '취소'}
        </Button>
      </div>
    </form>
  )
}
