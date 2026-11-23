import { beforeEach, expect, it, vi } from 'vitest'
import { campusRpc } from '../../src/lib/supabase/rpc'
import {
  createOpportunity,
  listOpportunities,
  matchingError,
  submitOpportunity,
} from '../../src/features/matching/matching-api'

vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: vi.fn() }))
const rpc = vi.mocked(campusRpc)

beforeEach(() => {
  rpc.mockReset()
})

it('공모전 필터를 페이지 오프셋과 함께 DB에 전달한다', async () => {
  rpc.mockResolvedValue([])
  await listOpportunities(
    'contest',
    {
      university: 'school-id',
      major: ' 디자인 ',
      skill: 'React',
      role: '개발',
      competition: '해커톤',
      format: 'online',
    },
    2,
  )
  expect(rpc).toHaveBeenCalledWith('list_matching_opportunities', {
    p_type: 'contest',
    p_mine: false,
    p_university_id: 'school-id',
    p_major: '디자인',
    p_skill: 'React',
    p_role: '개발',
    p_competition: '해커톤',
    p_format: 'online',
    p_offset: 40,
  })
})

it('글 유형을 바꾼 뒤에는 이전 유형의 필드를 전송하지 않는다', async () => {
  rpc.mockResolvedValue('opportunity-id')
  await createOpportunity(
    'idea',
    new FormData(
      Object.assign(document.createElement('form'), {
        innerHTML:
          '<input name="title" value=" 반쪽 아이디어 "><input name="description" value="서비스 아이디어를 설명합니다"><input name="roles" value=" 개발, 기획, 개발 "><input name="gap" value="함께 검증할 팀원"><input name="competition" value="전 유형 값">',
      }),
    ),
  )
  expect(rpc).toHaveBeenCalledWith('create_matching_opportunity', {
    p_type: 'idea',
    p_title: '반쪽 아이디어',
    p_description: '서비스 아이디어를 설명합니다',
    p_roles: ['개발', '기획'],
    p_skills: [],
    p_university_id: null,
    p_major: null,
    p_gap: '함께 검증할 팀원',
    p_source_project_id: null,
    p_competition: null,
    p_format: null,
    p_deadline: null,
  })
})

it('역할과 시간대를 입력하지 않고 지원할 수 있다', async () => {
  rpc.mockResolvedValue('request-id')
  const form = new FormData()
  form.set('message', ' 함께 참여하고 싶습니다 ')
  await submitOpportunity('opportunity-id', form)
  expect(rpc).toHaveBeenCalledWith('submit_matching_request', {
    p_opportunity_id: 'opportunity-id',
    p_message: '함께 참여하고 싶습니다',
    p_role: null,
    p_timezone: null,
  })
})

it('권한 없는 리부트 원본에 대해서는 존재 여부 대신 공개 원본 조건을 보여 준다', () => {
  expect(matchingError({ message: 'MATCHING_REBOOT_SOURCE_UNAVAILABLE' }, '실패')).toBe(
    '중단·완료된 공개 프로젝트만 리부트할 수 있습니다.',
  )
})
