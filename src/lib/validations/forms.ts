import { z } from 'zod'
import { categories } from '../constants/brand'

const requiredText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} ${min}자 이상 입력해 주세요.`)
    .max(max, `${label} ${max}자 이하로 입력해 주세요.`)
const category = z.enum(categories, { error: '프로젝트 유형을 선택해 주세요.' })
const visibility = z.enum(['private', 'public'])

export const emailSchema = z.object({ email: z.email('올바른 이메일을 입력해 주세요.').max(254) })
export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, '메일에 있는 6자리 코드를 입력해 주세요.'),
})
export const parseTags = (text: string) => [
  ...new Set(
    text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  ),
]

const tags = (label: string) =>
  z
    .string()
    .max(500)
    .refine((s) => {
      const items = parseTags(s)
      return items.length > 0 && items.length <= 10 && items.every((item) => item.length <= 40)
    }, `${label}: 쉼표로 구분해 최대 10개(각 40자 이하)를 입력해 주세요.`)

export const profileSchema = z.object({
  nickname: requiredText('닉네임은', 2, 30),
  universityId: z.uuid('소속 학교를 선택해 주세요.'),
  major: requiredText('전공은', 1, 80),
  bio: requiredText('자기소개는', 1, 1000),
  skills: tags('보유 역량'),
  interests: tags('관심 분야'),
  preferredCategory: category,
  visibility,
})

const date = z.union([z.literal(''), z.iso.date('올바른 날짜를 입력해 주세요.')])
export const projectSchema = z
  .object({
    title: requiredText('프로젝트 이름은', 2, 100),
    description: requiredText('프로젝트 소개는', 10, 4000),
    category,
    visibility,
    startDate: date,
    dueDate: date,
  })
  .refine((value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate, {
    path: ['dueDate'],
    message: '목표 종료일은 시작일과 같거나 이후여야 합니다.',
  })

export type ProfileFormValues = z.infer<typeof profileSchema>
export type ProjectFormValues = z.infer<typeof projectSchema>
