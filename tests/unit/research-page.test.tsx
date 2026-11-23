import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ResearchPage } from '../../src/features/research/ResearchPage'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: null as null | { id: string } }))
vi.mock('../../src/lib/supabase/client', () => ({ isSupabaseConfigured: true }))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: mocks.rpc }))
vi.mock('../../src/features/auth/auth-provider', () => ({
  useAuth: () => ({ session: mocks.user && { user: mocks.user }, loading: false }),
}))
vi.mock('../../src/features/universities/SchoolVerification', () => ({
  SchoolVerification: ({ children }: { children: React.ReactNode }) => children,
}))

function open(path: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/research/*" element={<ResearchPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.user = null
  mocks.rpc.mockReset()
})
afterEach(cleanup)

it('공개 모집은 비회원도 보지만 신청이나 테스트 링크는 노출되지 않는다', async () => {
  mocks.rpc.mockResolvedValue([
    {
      id: 'test',
      title: '앱 사용성 조사',
      description: '설명을 읽어 주세요.',
      capacity: 3,
      slots_left: 2,
      reward: 1,
    },
  ])
  open('/research')

  expect(await screen.findByRole('heading', { name: '앱 사용성 조사' })).toBeVisible()
  expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
  expect(screen.queryByRole('button', { name: '참여 신청' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '테스트 열기' })).not.toBeInTheDocument()
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_research_tests')
})

it('테스트 링크를 열어도 제출되지 않고 직접 입력한 피드백만 전달된다', async () => {
  mocks.user = { id: 'tester' }
  mocks.rpc.mockImplementation((name: string) =>
    name === 'my_research_work'
      ? {
          organized: [],
          participating: [
            {
              id: 'entry',
              test_id: 'test',
              title: '앱 사용성 조사',
              description: '앱을 사용해 보세요.',
              reward: 1,
              test_status: 'open',
              test_url: 'https://example.org/test',
              status: 'applied',
            },
          ],
        }
      : null,
  )
  open('/research/mine')

  const link = await screen.findByRole('link', { name: '테스트 열기' })
  expect(link).toHaveAttribute('href', 'https://example.org/test')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  link.addEventListener('click', (event) => event.preventDefault())
  fireEvent.click(link)
  expect(mocks.rpc).not.toHaveBeenCalledWith('submit_research_feedback', expect.anything())

  const submit = screen.getByRole('button', { name: '피드백 제출' })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: '피드백' }), {
    target: { value: '처음 화면에서 버튼을 찾기 어려웠습니다.' },
  })
  fireEvent.click(submit)
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith('submit_research_feedback', {
      p_test_id: 'test',
      p_feedback: '처음 화면에서 버튼을 찾기 어려웠습니다.',
    }),
  )
})

it('진행자는 제출된 피드백을 본 후 직접 보상을 지급한다', async () => {
  mocks.user = { id: 'organizer' }
  mocks.rpc.mockImplementation((name: string) =>
    name === 'my_research_work'
      ? {
          participating: [],
          organized: [
            {
              id: 'test',
              title: '앱 사용성 조사',
              capacity: 2,
              slots_left: 0,
              reward: 1,
              reserved_remaining: 2,
              status: 'open',
              participants: [
                {
                  id: 'submitted-entry',
                  nickname: '참여자 하나',
                  feedback: '테스트 설명이 이해하기 쉬웠습니다.',
                  status: 'submitted',
                },
                { id: 'applied-entry', nickname: '참여자 둘', feedback: null, status: 'applied' },
              ],
            },
          ],
        }
      : null,
  )
  open('/research/mine')

  expect(await screen.findByText('테스트 설명이 이해하기 쉬웠습니다.')).toBeVisible()
  expect(screen.queryByRole('button', { name: '모집 종료' })).not.toBeInTheDocument()
  const pay = screen.getByRole('button', { name: '1 크레딧 지급' })
  expect(mocks.rpc).not.toHaveBeenCalledWith('confirm_research_participation', expect.anything())
  fireEvent.click(pay)
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith('confirm_research_participation', {
      p_participation_id: 'submitted-entry',
    }),
  )
})
