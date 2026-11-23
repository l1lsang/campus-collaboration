import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, it, vi } from 'vitest'
import { ArchivePage } from '../../src/features/reports/ArchivePage'
import { ProjectReportsPage } from '../../src/features/reports/ProjectReportsPage'
import { workspaceKey } from '../../src/features/reports/reports-api'

const { rpc, auth } = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn() }))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: rpc }))
vi.mock('../../src/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: (...args: unknown[]) => ({
      setHeader: () => ({
        abortSignal: async () => ({ data: await rpc(...args), error: null }),
      }),
    }),
  }),
}))
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
  auth.mockReset().mockReturnValue({
    loading: false,
    session: { user: { id: userId } },
    getVerifiedRequest: () => ({ accessToken: 'verified', signal: new AbortController().signal }),
  })
})

function show(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:id/reports" element={<ProjectReportsPage />} />
          <Route path="/archive" element={<ArchivePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const editedLayout = {
  title: '팀 내부 정리',
  source: 'template',
  sections: [
    { heading: '다음 단계', body: '<b>평문</b>' },
    { heading: '활동 타임라인', body: '작업 완료' },
  ],
}
const editedRevision = { ...revision, draft: { method: 'editable', ...editedLayout } }
const activityKey = workspaceKey(userId, { p_project_id: projectId, p_kind: 'activity' })

it('편집하지 않은 보고서는 작업공간이 갱신되면 최신판을 자동으로 불러온다', async () => {
  let latestRevision = editedRevision
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace')
      return { ...workspace, isOwner: true, latestRevision }
    if (name === 'list_project_report_revisions') return [latestRevision]
    throw new Error(name)
  })
  const client = show(`/projects/${projectId}/reports`)
  const title = await screen.findByLabelText('보고서 제목')
  expect(title).toHaveValue(editedLayout.title)

  latestRevision = {
    ...editedRevision,
    id: 'revision-2',
    number: 2,
    draft: { ...editedRevision.draft, title: '다른 창에서 저장한 제목', sections: [] },
  }
  await act(() => client.invalidateQueries({ queryKey: activityKey }))

  await waitFor(() => expect(title).toHaveValue('다른 창에서 저장한 제목'))
  expect(screen.getByText(/편집 기준: 2판/)).toBeInTheDocument()
  expect(screen.queryByLabelText('본문')).not.toBeInTheDocument()
})

it('편집 중 최신판이 도착하면 내 변경을 남기고 명시적으로 다시 불러오게 한다', async () => {
  let latestRevision: typeof editedRevision | null = null
  let reloadFails = false
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace') {
      if (reloadFails) throw new Error('network unavailable')
      return { ...workspace, isOwner: true, latestRevision }
    }
    if (name === 'list_project_report_revisions') return latestRevision ? [latestRevision] : []
    throw new Error(name)
  })
  const client = show(`/projects/${projectId}/reports`)
  const title = await screen.findByLabelText('보고서 제목')
  fireEvent.change(title, { target: { value: '저장되지 않은 내 제목' } })

  latestRevision = editedRevision
  await act(() => client.invalidateQueries({ queryKey: activityKey }))

  expect(await screen.findByRole('alert')).toHaveTextContent('편집하는 동안 최신판이 바뀌었습니다.')
  expect(title).toHaveValue('저장되지 않은 내 제목')
  expect(screen.getByRole('button', { name: '새 판 저장' })).toBeDisabled()
  reloadFails = true
  const reload = screen.getByRole('button', { name: '현재 변경을 버리고 최신판 불러오기' })
  fireEvent.click(reload)
  expect(await screen.findByText(/최신판을 불러오지 못했습니다/)).toBeInTheDocument()
  expect(screen.getByText(/편집하는 동안 최신판이 바뀌었습니다/)).toBeInTheDocument()
  expect(title).toHaveValue('저장되지 않은 내 제목')

  reloadFails = false
  latestRevision = {
    ...editedRevision,
    id: 'revision-2',
    number: 2,
    draft: { ...editedRevision.draft, title: '다시 불러올 때의 최신 제목' },
  }
  fireEvent.click(reload)

  await waitFor(() => expect(title).toHaveValue('다시 불러올 때의 최신 제목'))
  expect(screen.getByText(/편집 기준: 2판/)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText('저장되지 않은 변경이 있습니다.')).not.toBeInTheDocument()
})

it('소유자가 템플릿 근거를 삭제하고 새 제목과 섹션 순서로 저장한다', async () => {
  let latestRevision: typeof editedRevision | null = null
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace')
      return { ...workspace, isOwner: true, latestRevision }
    if (name === 'list_project_report_revisions') return latestRevision ? [latestRevision] : []
    if (name === 'preview_project_report')
      return { ...draft, sections: [...draft.sections, { key: 'explanation', items: [] }] }
    if (name === 'save_project_report_layout') {
      latestRevision = editedRevision
      return latestRevision
    }
    if (name === 'get_project_report_revision') return latestRevision
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  fireEvent.click(await screen.findByRole('button', { name: '템플릿 초안 만들기' }))
  fireEvent.click(await screen.findByRole('button', { name: '설명 및 판단 근거 삭제' }))
  expect(screen.queryByDisplayValue('설명 및 판단 근거')).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('보고서 제목'), { target: { value: editedLayout.title } })
  fireEvent.click(screen.getByRole('button', { name: '섹션 추가' }))
  const section = screen.getByRole('group', { name: '섹션 2' })
  fireEvent.change(within(section).getByLabelText('제목'), { target: { value: '다음 단계' } })
  fireEvent.change(within(section).getByLabelText('본문'), { target: { value: '<b>평문</b>' } })
  fireEvent.click(within(section).getByRole('button', { name: '위로' }))
  expect(screen.getByText('저장되지 않은 변경이 있습니다.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '새 판 저장' }))
  expect(await screen.findByText('1판을 저장했습니다.')).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith('save_project_report_layout', {
    p_project_id: projectId,
    p_kind: 'activity',
    p_expected_number: 0,
    p_layout: editedLayout,
  })
  expect(rpc).toHaveBeenCalledWith('get_project_report_revision', {
    p_project_id: projectId,
    p_kind: 'activity',
    p_revision_id: 'revision-1',
  })
  expect(await screen.findByLabelText('공개 제목')).toHaveValue('')
})

it('팀원은 저장된 편집 본문의 평문만 읽고 편집할 수 없다', async () => {
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace')
      return { ...workspace, latestRevision: editedRevision }
    if (name === 'list_project_report_revisions') return [editedRevision]
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  expect(await screen.findByRole('heading', { name: editedLayout.title })).toBeInTheDocument()
  const plainText = screen.getByText('<b>평문</b>')
  expect(plainText.querySelector('b')).toBeNull()
  expect(screen.queryByText('설명 및 판단 근거')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('보고서 제목')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '새 판 저장' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('공개 제목')).not.toBeInTheDocument()
})

it('기존 생성 판은 그대로 읽고 템플릿 근거의 출처를 표시한다', async () => {
  const latest = { ...editedRevision, id: 'revision-2', number: 2 }
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace') return { ...workspace, latestRevision: latest }
    if (name === 'list_project_report_revisions') return [latest, revision]
    if (name === 'get_project_report_revision') return revision
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  fireEvent.click(await screen.findByRole('button', { name: '1판 보기' }))
  expect(await screen.findByRole('heading', { name: '이력 · 1판' })).toBeInTheDocument()
  expect(screen.getByText('작업 완료')).toBeInTheDocument()
  expect(screen.getByText('팀 활동 기록')).toBeInTheDocument()
  expect(screen.queryByText('activity:123')).not.toBeInTheDocument()
})

it('공백 제목은 로컬에서 거절하고 저장 충돌 시 편집 내용을 남긴다', async () => {
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace')
      return { ...workspace, isOwner: true, latestRevision: editedRevision }
    if (name === 'list_project_report_revisions') return [editedRevision]
    if (name === 'save_project_report_layout') throw new Error('REPORT_REVISION_CONFLICT')
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  const title = await screen.findByLabelText('보고서 제목')
  const save = screen.getByRole('button', { name: '새 판 저장' })
  fireEvent.change(title, { target: { value: '  ' } })
  fireEvent.click(save)
  expect(await screen.findByRole('alert')).toHaveTextContent('보고서 제목을 입력해 주세요.')
  expect(rpc.mock.calls.some(([name]) => name === 'save_project_report_layout')).toBe(false)
  fireEvent.change(title, { target: { value: '아직 저장하지 않은 제목' } })
  fireEvent.click(save)
  expect(await screen.findByRole('alert')).toHaveTextContent('편집하는 동안 최신판이 바뀌었습니다.')
  expect(title).toHaveValue('아직 저장하지 않은 제목')
  expect(
    screen.getByRole('button', { name: '현재 변경을 버리고 최신판 불러오기' }),
  ).toBeInTheDocument()
})

it('한글과 JSON 줄바꿈이 전체 바이트 한도를 넘으면 본문을 줄이도록 안내한다', async () => {
  const boundaryBody = '\n'.repeat(22_986)
  const boundary = {
    title: '제목',
    source: 'blank',
    sections: [
      ...Array.from({ length: 3 }, () => ({ heading: 'A', body: '한'.repeat(24_000) })),
      { heading: 'B', body: boundaryBody },
    ],
  }
  const starting = {
    ...editedRevision,
    draft: { ...boundary, method: 'editable' },
  }
  const saved = { ...starting, id: 'revision-2', number: 2 }
  let latestRevision = starting
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace')
      return { ...workspace, isOwner: true, latestRevision }
    if (name === 'list_project_report_revisions') return [latestRevision]
    if (name === 'save_project_report_layout') {
      latestRevision = saved
      return saved
    }
    if (name === 'get_project_report_revision') return saved
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  const section = await screen.findByRole('group', { name: '섹션 4' })
  const body = within(section).getByLabelText('본문')
  const submit = screen.getByRole('button', { name: '새 판 저장' })
  fireEvent.change(body, { target: { value: `${boundaryBody}x` } })
  fireEvent.click(submit)
  expect(await screen.findByRole('alert')).toHaveTextContent(/262,144바이트.*본문을 줄이거나/)
  expect(rpc.mock.calls.some(([name]) => name === 'save_project_report_layout')).toBe(false)

  fireEvent.change(body, { target: { value: boundaryBody } })
  fireEvent.click(submit)
  expect(await screen.findByText('2판을 저장했습니다.')).toBeInTheDocument()
  expect(rpc).toHaveBeenCalledWith('save_project_report_layout', {
    p_project_id: projectId,
    p_kind: 'activity',
    p_expected_number: 1,
    p_layout: boundary,
  })
})

it('저장한 판의 문안이 다시 조회되지 않으면 성공이라고 표시하지 않는다', async () => {
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace') return { ...workspace, isOwner: true }
    if (name === 'list_project_report_revisions') return []
    if (name === 'save_project_report_layout' || name === 'get_project_report_revision')
      return editedRevision
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  const title = await screen.findByLabelText('보고서 제목')
  fireEvent.change(title, { target: { value: '제목만 작성한 초안' } })
  fireEvent.click(screen.getByRole('button', { name: '새 판 저장' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('저장 결과를 확인하지 못했습니다.')
  expect(screen.queryByText('1판을 저장했습니다.')).not.toBeInTheDocument()
  expect(title).toHaveValue('제목만 작성한 초안')
  expect(rpc).toHaveBeenCalledWith('save_project_report_layout', {
    p_project_id: projectId,
    p_kind: 'activity',
    p_expected_number: 0,
    p_layout: { title: '제목만 작성한 초안', source: 'blank', sections: [] },
  })
})

it('저장 확인 후 작업공간 갱신이 실패해도 저장된 판을 보여 준다', async () => {
  const saved = {
    ...editedRevision,
    draft: { method: 'editable', title: '제목만 작성한 초안', source: 'blank', sections: [] },
  }
  let hasSaved = false
  rpc.mockImplementation(async (name: string) => {
    if (name === 'get_project_report_workspace') {
      if (hasSaved) throw new Error('network unavailable')
      return { ...workspace, isOwner: true }
    }
    if (name === 'list_project_report_revisions') return hasSaved ? [saved] : []
    if (name === 'save_project_report_layout') {
      hasSaved = true
      return saved
    }
    if (name === 'get_project_report_revision') return saved
    throw new Error(name)
  })
  show(`/projects/${projectId}/reports`)
  fireEvent.change(await screen.findByLabelText('보고서 제목'), {
    target: { value: saved.draft.title },
  })
  fireEvent.click(screen.getByRole('button', { name: '새 판 저장' }))
  expect(await screen.findByText('1판을 저장했습니다.')).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: saved.draft.title })).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: '새 판 저장' })).toBeDisabled())
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
        latestRevision: editedRevision,
      }
    if (name === 'list_project_report_revisions') return [editedRevision]
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
