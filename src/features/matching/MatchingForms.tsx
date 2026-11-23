import { useId, useRef, useState, type FormEvent } from 'react'
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
import {
  confirmReboot,
  hasPendingReboot,
  publishReboot,
  rebootAttachmentAccept,
} from './reboot-attachments'

type PublishAction =
  | { kind: 'confirm' }
  | { kind: 'reboot'; form: FormData; file: File | null }
  | { kind: 'other'; type: Exclude<OpportunityType, 'reboot'>; form: FormData }

export function PublishForm({ userId, onPublished }: { userId: string; onPublished: () => void }) {
  const [type, setType] = useState<OpportunityType>('idea')
  const [source, setSource] = useState<{ id: string; title: string } | null>(null)
  const [selectedFile, setSelectedFile] = useState(false)
  const attachmentInput = useRef<HTMLInputElement>(null)
  const [needsRebootCheck, setNeedsRebootCheck] = useState(() => hasPendingReboot(userId))
  const [checkedReboot, setCheckedReboot] = useState(false)
  const submitting = useRef(false)
  const cache = useQueryClient()
  const publish = useMutation({
    mutationFn: (action: PublishAction) => {
      if (action.kind === 'confirm') return confirmReboot(userId)
      if (action.kind === 'reboot') return publishReboot(action.form, action.file, userId)
      return createOpportunity(action.type, action.form)
    },
    retry: false,
    onSuccess: (id) => {
      if (id !== null) void cache.invalidateQueries({ queryKey: matchingKey(userId) })
    },
    onSettled: () => {
      submitting.current = false
      setNeedsRebootCheck(hasPendingReboot(userId))
    },
  })

  function run(action: PublishAction) {
    if (submitting.current) return
    submitting.current = true
    setCheckedReboot(false)
    // Mutation-scoped UI updates are skipped after navigating away or switching accounts.
    publish.mutate(action, {
      onSuccess: (id) => {
        if (id === null) setCheckedReboot(true)
        else onPublished()
      },
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || needsRebootCheck) return
    if (hasPendingReboot(userId)) {
      setNeedsRebootCheck(true)
      return
    }
    const form = new FormData(event.currentTarget)
    if (type === 'reboot') {
      form.set('source_project', source?.id ?? '')
      run({ kind: 'reboot', form, file: attachmentInput.current?.files?.[0] ?? null })
    } else {
      run({ kind: 'other', type, form })
    }
  }

  return (
    <form className="panel flow" onSubmit={submit}>
      <h2>모집글 등록</h2>
      <p className="muted">학교 Google 계정으로 로그인한 학생에게 표시됩니다.</p>
      {needsRebootCheck && (
        <Notice>새로 등록하기 전에 이전 리부트 등록 결과를 확인해 주세요.</Notice>
      )}
      <fieldset className="flow" disabled={publish.isPending || needsRebootCheck}>
        <Field id="matching-type" label="모집 유형">
          <select
            id="matching-type"
            className="input"
            value={type}
            onChange={(event) => {
              setType(event.target.value as OpportunityType)
              setSource(null)
              setSelectedFile(false)
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
          <>
            <Field id="reboot-prior-work" label="이전까지 해 둔 작업">
              <textarea
                id="reboot-prior-work"
                name="reboot_prior_work"
                className="input"
                rows={3}
                required
                minLength={2}
                maxLength={2000}
              />
            </Field>
            <Field id="reboot-changes" label="멈춘 이유와 바꿀 점">
              <textarea
                id="reboot-changes"
                name="reboot_changes"
                className="input"
                rows={3}
                required
                minLength={2}
                maxLength={2000}
              />
            </Field>
            <Field
              id="reboot-attachment"
              label="작업 자료 첨부 (선택)"
              hint="PDF·JPG·PNG 1개, 최대 10MB. 게시하면 학교 Google 계정으로 인증한 학생이 내려받을 수 있습니다. 개인정보나 비공개 자료는 첨부하지 마세요."
            >
              <input
                ref={attachmentInput}
                id="reboot-attachment"
                name="reboot_attachment"
                type="file"
                className="input"
                accept={rebootAttachmentAccept}
                aria-describedby="reboot-attachment-help"
                onChange={(event) => setSelectedFile(!!event.target.files?.length)}
              />
            </Field>
            {selectedFile && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (attachmentInput.current) attachmentInput.current.value = ''
                  setSelectedFile(false)
                }}
              >
                첨부 빼기
              </Button>
            )}
            <details className="flow">
              <summary>공개 원본 연결 (선택)</summary>
              <RebootSourcePicker userId={userId} selected={source} onSelect={setSource} />
            </details>
          </>
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
      {checkedReboot && (
        <Notice>대기 중인 등록 요청이 없습니다. 내 모집글에서 게시 여부를 확인할 수 있어요.</Notice>
      )}
      {needsRebootCheck ? (
        <Button type="button" disabled={publish.isPending} onClick={() => run({ kind: 'confirm' })}>
          {publish.isPending ? '확인하는 중…' : '이전 등록 결과 확인'}
        </Button>
      ) : (
        <Button type="submit" disabled={publish.isPending}>
          {publish.isPending ? '등록하는 중…' : '모집글 올리기'}
        </Button>
      )}
    </form>
  )
}

function RebootSourcePicker({
  userId,
  selected,
  onSelect,
}: {
  userId: string
  selected: { id: string; title: string } | null
  onSelect: (source: { id: string; title: string } | null) => void
}) {
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const sources = useQuery({
    queryKey: [...matchingKey(userId), 'sources', search, page],
    queryFn: () => listRebootSources(search, page),
  })
  const options = sources.isSuccess ? sources.data.slice(0, matchingPageSize) : []
  if (selected && !options.some((option) => option.id === selected.id)) options.unshift(selected)
  const runSearch = () => {
    setSearch(draft.trim())
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
      ) : null}
      {(sources.isSuccess || selected) && (
        <Field id="reboot-source" label="리부트할 공개 프로젝트">
          <select
            id="reboot-source"
            className="input"
            value={selected?.id ?? ''}
            onChange={(event) =>
              onSelect(options.find(({ id }) => id === event.target.value) ?? null)
            }
          >
            <option value="">
              {options.length ? '연결하지 않음' : '조건에 맞는 공개 원본이 없어요'}
            </option>
            {options.map(({ id, title }) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </Field>
      )}
      {sources.isSuccess && <Paging page={page} count={sources.data.length} onChange={setPage} />}
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
