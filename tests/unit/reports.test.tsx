import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { ArchivePage } from '../../src/features/reports/ArchivePage'
import { ProjectReportsPage } from '../../src/features/reports/ProjectReportsPage'

const { rpc, auth } = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn() }))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: rpc }))
vi.mock('../../src/features/auth/auth-provider', () => ({ useAuth: auth }))

const projectId = '00000000-0000-4000-8100-000000000101'
const userId = '00000000-0000-4000-8100-000000000201'
const draft = {
  method: 'template',
  sections: [{ key: 'activity', items: [{ text: '작업 완료', sourceIds: ['activity:123'] }] }],
  notes: [],
}
const revision = {
  id: 'revision-1',
  number: 1,
  createdAt: '2026-11-23T00:00:00Z',
  inputs: {},
  draft,
}
const workspace = {
  title: '내부 프로젝트',
  isOwner: false,
  publication: null,
  latestRevision: null,
}

beforeEach(() => {
  rpc.mockReset()
  auth.mockReset().mockReturnValue({ loading: false, session: { user: { id: userId } } })
})

function show(path: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:id/reports" element={<ProjectReportsPage />} />
          <Route path="/archive" element={<ArchivePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

it('팀원이 설명을 근거로 미리 보고 새로운 판을 저장한다', async () => {
  let latestRevision: typeof revision | null = null
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace') return { ...workspace, latestRevision }
    if (name === 'list_project_report_revisions') return latestRevision ? [latestRevision] : []
    if (name === 'preview_project_report') return draft
    if (name === 'save_project_report') {
      latestRevision = { ...revision, inputs: { explanation: '직접 확인한 사유' } }
      return latestRevision
    }
    if (name === 'get_project_report_revision') return latestRevision
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  fireEvent.change(await screen.findByLabelText('설명 및 판단 근거'), {
    target: { value: '직접 확인한 사유' },
  })
  fireEvent.click(screen.getByRole('button', { name: '템플릿 초안 만들기' }))
  expect(await screen.findByText('작업 완료')).toBeInTheDocument()
  expect(screen.getByText('팀 활동 기록')).toBeInTheDocument()
  expect(screen.queryByText('activity:123')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '새 판 저장' }))
  expect(await screen.findByText('1판을 저장했습니다.')).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith('save_project_report', {
    p_project_id: projectId,
    p_kind: 'activity',
    p_expected_number: 0,
    p_inputs: { explanation: '직접 확인한 사유' },
  })
  expect(screen.queryByLabelText('공개 제목')).not.toBeInTheDocument()
})

it('소유자도 비공개 초안을 자동으로 옮기지 않으며 동의한 공개 문안만 보낸다', async () => {
  const snapshot = {
    id: 'snapshot-1',
    revisionNumber: 1,
    kind: 'activity',
    publishedAt: '2026-11-23T00:00:00Z',
    title: '공개할 제목',
    summary: '공개할 내용',
  }
  let publication: typeof snapshot | null = null
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace')
      return {
        ...workspace,
        isOwner: true,
        publication,
        latestRevision: { ...revision, inputs: { results: '비공개 성과' } },
      }
    if (name === 'list_project_report_revisions') return [revision]
    if (name === 'publish_project_report') {
      publication = snapshot
      return publication
    }
    if (name === 'unpublish_project_report') {
      publication = null
      return null
    }
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  expect(await screen.findByLabelText('공개 제목')).toHaveValue('')
  expect(screen.getByLabelText('공개할 결과')).toHaveValue('')
  const publish = screen.getByRole('button', { name: '아카이브에 공개' })
  fireEvent.change(screen.getByLabelText('공개 제목'), { target: { value: '공개할 제목' } })
  fireEvent.change(screen.getByLabelText('공개 요약'), { target: { value: '공개할 내용' } })
  expect(publish).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: /공개하는 데 동의/ }))
  fireEvent.click(publish)
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith('publish_project_report', {
      p_project_id: projectId,
      p_kind: 'activity',
      p_revision_id: 'revision-1',
      p_opt_in: true,
      p_content: { title: '공개할 제목', summary: '공개할 내용' },
    }),
  )
  expect(await screen.findByText('공개 아카이브에 게시했습니다.')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: '공개 취소' }))
  expect(await screen.findByText('공개를 취소했습니다.')).toBeInTheDocument()
  expect(screen.queryByText(/현재 공개 중/)).not.toBeInTheDocument()
})

it('비회원도 아카이브에서 공개 문안만 본다', async () => {
  auth.mockReturnValue({ loading: false, session: null })
  rpc.mockResolvedValue([
    {
      id: 'snapshot-1',
      kind: 'handoff',
      publishedAt: '2026-11-23T00:00:00Z',
      title: '공개 스냅샷',
      summary: '안전하게 공개된 요약',
      handoff: '배포 담당 교체 안내',
    },
  ])
  show('/archive')
  expect(await screen.findByRole('heading', { name: '공개 스냅샷' })).toBeInTheDocument()
  expect(screen.getByText('배포 담당 교체 안내')).toBeInTheDocument()
  expect(screen.queryByText('내부 프로젝트')).not.toBeInTheDocument()
})

it('권한이 없는 사용자에게 편집 폼이나 저장 버튼을 보이지 않는다', async () => {
  rpc.mockRejectedValue(new Error('PROJECT_MEMBER_REQUIRED'))
  show(`/projects/${projectId}/reports`)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '이 프로젝트의 팀원만 보고서를 이용할 수 있습니다.',
  )
  expect(screen.queryByRole('button', { name: '새 판 저장' })).not.toBeInTheDocument()
  expect(rpc).toHaveBeenCalledTimes(1)
})
