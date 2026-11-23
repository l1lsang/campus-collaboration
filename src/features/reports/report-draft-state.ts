import { createContext, useContext } from 'react'
import type { ReportKind, ReportLayout, ReportSection, RevisionHeader } from './reports-api'

export type EditorSection = ReportSection & { id: string }
export type EditorLayout = Omit<ReportLayout, 'sections'> & { sections: EditorSection[] }
export type EditorBase = Pick<RevisionHeader, 'number' | 'createdAt'> & { editable: boolean }
export type UnsavedReport = {
  kind: ReportKind
  base: EditorBase | null
  layout: EditorLayout
  nextSection: number
}

export const ReportDraftContext = createContext<{
  draft: UnsavedReport | null
  setDraft: (draft: UnsavedReport | null) => void
} | null>(null)

export const useReportDraft = () => useContext(ReportDraftContext)
