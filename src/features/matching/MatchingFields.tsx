import { Field, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useUniversities } from '../profiles/profile-api'
import { formatLabels, matchingError, matchingPageSize } from './matching-api'

export function QueryFailure({
  error,
  fallback,
  retry,
}: {
  error: unknown
  fallback: string
  retry: () => unknown
}) {
  return (
    <Notice kind="error">
      {matchingError(error, fallback)}{' '}
      <button className="text-link" type="button" onClick={() => void retry()}>
        다시 시도
      </button>
    </Notice>
  )
}

export function Paging({
  page,
  count,
  onChange,
}: {
  page: number
  count: number
  onChange: (page: number) => void
}) {
  if (!page && count <= matchingPageSize) return null
  return (
    <nav className="wrap" aria-label="페이지 이동">
      <Button
        type="button"
        variant="outline"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        이전
      </Button>
      <span aria-live="polite">{page + 1}페이지</span>
      <Button
        type="button"
        variant="outline"
        disabled={count <= matchingPageSize}
        onClick={() => onChange(page + 1)}
      >
        다음
      </Button>
    </nav>
  )
}

export function UniversityField({ id, value }: { id: string; value?: string }) {
  const schools = useUniversities()
  return (
    <Field id={id} label="대상 대학 (선택)">
      <select
        id={id}
        name="university"
        className="input"
        defaultValue={value}
        disabled={schools.isPending || schools.isError}
      >
        <option value="">{schools.isPending ? '대학 목록 불러오는 중…' : '대학 제한 없음'}</option>
        {schools.data?.map((school) => (
          <option key={school.id} value={school.id}>
            {school.name}
          </option>
        ))}
      </select>
      {schools.isError && (
        <QueryFailure
          error={schools.error}
          fallback="대학 목록을 불러오지 못했습니다."
          retry={schools.refetch}
        />
      )}
    </Field>
  )
}

export function FormatOptions() {
  return Object.entries(formatLabels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ))
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

export function LocalTime({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>
}
