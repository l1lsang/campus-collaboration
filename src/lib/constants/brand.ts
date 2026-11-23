const wordmark = 'collab'

export const brand = {
  wordmark,
  name: `${wordmark}.`,
  workspace: '팀플로그',
} as const

export const categories = [
  'course',
  'competition',
  'hackathon',
  'startup',
  'side_project',
  'research',
  'creative',
  'other',
] as const

export type Category = (typeof categories)[number]
export const categoryLabels: Record<Category, string> = {
  course: '교내 팀 프로젝트',
  competition: '교외 공모전',
  hackathon: '해커톤',
  startup: '창업',
  side_project: '사이드 프로젝트',
  research: '연구',
  creative: '디자인 · 콘텐츠',
  other: '기타',
}
export const categoryLabel = (value: string) => categoryLabels[value as Category] ?? '기타'
