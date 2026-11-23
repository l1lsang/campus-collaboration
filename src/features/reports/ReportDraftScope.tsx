import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router'
import { useAuth } from '../auth/auth-provider'
import { ReportDraftContext, useReportDraft, type UnsavedReport } from './report-draft-state'

function DraftMemory() {
  const [draft, setDraft] = useState<UnsavedReport | null>(null)
  return (
    <ReportDraftContext.Provider value={{ draft, setDraft }}>
      <Outlet />
    </ReportDraftContext.Provider>
  )
}

export function ReportDraftScope() {
  const { id } = useParams()
  const { verifiedSessionContinuity } = useAuth()
  // Only the unsaved editor fields survive a refresh; both guards still remove
  // the protected outlet and all other report UI while verification is pending.
  return verifiedSessionContinuity == null ? (
    <Outlet />
  ) : (
    <DraftMemory key={`${verifiedSessionContinuity}:${id}`} />
  )
}

export function DiscardReportDraft() {
  const setDraft = useReportDraft()?.setDraft
  useEffect(() => setDraft?.(null), [setDraft])
  return null
}
