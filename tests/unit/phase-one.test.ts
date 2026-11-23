import { describe, expect, it } from 'vitest'
import { authReturnPath, getInviteToken } from '../../src/features/auth/return-path'
import { profileSchema, projectSchema, parseTags } from '../../src/lib/validations/forms'

const token = 'a'.repeat(64)
const baseProject = {
  title: '캠퍼스 앱 프로젝트',
  description: '학교 간 협업을 위한 웹 서비스입니다.',
  category: 'side_project',
  visibility: 'private',
  startDate: '2026-02-28',
  dueDate: '2026-03-01',
}

describe('참여 링크 및 로그인 복귀 경로', () => {
  it('초대 토큰은 정확히 64자리 소문자 hex 값만 허용한다', () => {
    expect(getInviteToken(`#${token}`)).toBe(token)
    expect(getInviteToken(`#${token}f`)).toBeNull()
    expect(getInviteToken(`#${token.toUpperCase()}`)).toBeNull()
    expect(getInviteToken(`?token=${token}`)).toBeNull()
  })
  it('초대 링크의 프래그먼트를 가입 후에도 유지한다', () => {
    expect(authReturnPath(`/invite#${token}`)).toBe(`/invite#${token}`)
    expect(authReturnPath('/projects/new')).toBe('/projects/new')
  })
  it('허용되지 않은 외부 또는 내부 주소로 이동하지 않는다', () => {
    for (const path of [
      '//example.invalid',
      'https://example.invalid',
      '/\\example.invalid',
      '/admin',
      '/invite#wrong',
    ]) {
      expect(authReturnPath(path)).toBe('/dashboard')
    }
  })
})

describe('프로젝트 및 프로필 입력', () => {
  it('프로젝트 시작일보다 이른 마감일을 거부한다', () => {
    expect(projectSchema.safeParse(baseProject).success).toBe(true)
    expect(projectSchema.safeParse({ ...baseProject, dueDate: '2026-02-27' }).success).toBe(false)
  })
  it('달력에 없는 날짜 또는 지원하지 않는 공개 범위를 거부한다', () => {
    expect(projectSchema.safeParse({ ...baseProject, startDate: '2026-02-30' }).success).toBe(false)
    expect(projectSchema.safeParse({ ...baseProject, visibility: 'everyone' }).success).toBe(false)
  })
  it('프로필 기술과 관심사를 중복 없이 분리한다', () => {
    expect(parseTags(' React, React,  , 디자인 ')).toEqual(['React', '디자인'])
    const valid = {
      nickname: '테스터',
      universityId: '2c11d87a-358b-4f45-934f-a88d95574a41',
      major: '컴퓨터과학',
      bio: '함께 만드는 걸 좋아합니다.',
      interests: '접근성',
      skills: 'React',
      preferredCategory: 'side_project',
      visibility: 'private',
    }
    expect(profileSchema.safeParse(valid).success).toBe(true)
    expect(profileSchema.safeParse({ ...valid, universityId: '' }).success).toBe(false)
    expect(profileSchema.safeParse({ ...valid, skills: ' , ' }).success).toBe(false)
  })
})
