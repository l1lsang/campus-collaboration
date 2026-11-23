import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export function Notice({
  children,
  kind = 'info',
}: {
  children: ReactNode
  kind?: 'info' | 'error' | 'success'
}) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'error' && <CircleAlert size={18} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  )
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" size={20} aria-hidden="true" />
      {label}
    </div>
  )
}

export function Unconfigured() {
  return (
    <Notice>
      <strong>Supabase 연결 설정이 필요합니다.</strong>
      <p>로컬 개발 설정은 프로젝트 README의 실행 방법을 확인해 주세요.</p>
    </Notice>
  )
}

export function PageHeading({
  label,
  title,
  description,
}: {
  label?: string
  title: string
  description?: string
}) {
  return (
    <header className="page-heading">
      {label && <p className="eyebrow">{label}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  )
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" role="alert" id={`${id}-help`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={`${id}-help`}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}
