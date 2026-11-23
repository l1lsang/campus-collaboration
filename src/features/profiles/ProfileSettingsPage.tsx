import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { Field, Loading, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import type { Tables } from '../../lib/supabase/database.types'
import { userError } from '../../lib/supabase/errors'
import { categories, categoryLabels } from '../../lib/constants/brand'
import { profileSchema, type ProfileFormValues } from '../../lib/validations/forms'
import { authReturnPath } from '../auth/return-path'
import { useAuth } from '../auth/auth-provider'
import { SchoolVerification } from '../universities/SchoolVerification'
import { profileKey, saveProfile, useMyProfile, useUniversities } from './profile-api'

type University = Pick<Tables<'universities'>, 'id' | 'name'>

export function ProfileSettingsPage({ onboarding = false }: { onboarding?: boolean }) {
  const { session, schoolId } = useAuth()
  const location = useLocation()
  const next = authReturnPath((location.state as { next?: unknown } | null)?.next)
  const user = session!.user
  const profile = useMyProfile(user.id)
  const universities = useUniversities()
  const university = universities.data?.find((school) => school.id === schoolId)
  return (
    <main className="narrow page" id="main-content">
      <PageHeading
        label={onboarding ? '첫 방문' : '내 계정'}
        title={onboarding ? '프로필 만들기' : '계정 설정'}
        description="어떤 것을 함께 만들고 싶은지 알려주세요. 공개 범위는 직접 결정할 수 있습니다."
      />
      {profile.isPending || universities.isPending ? (
        <Loading />
      ) : profile.isError || universities.isError ? (
        <Notice kind="error">
          프로필 설정을 불러오지 못했습니다.{' '}
          <button
            className="text-link"
            onClick={() => {
              void profile.refetch()
              void universities.refetch()
            }}
          >
            다시 시도
          </button>
        </Notice>
      ) : !university ? (
        <Notice kind="error">
          인증된 학교 정보를 찾지 못했습니다.{' '}
          <button className="text-link" onClick={() => void universities.refetch()}>
            다시 시도
          </button>
        </Notice>
      ) : (
        <ProfileForm
          key={`${user.id}:${university.id}`}
          userId={user.id}
          profile={profile.data}
          university={university}
          next={onboarding ? (next === '/onboarding' ? '/dashboard' : next) : undefined}
        />
      )}
      {!onboarding && (
        <div className="section-gap">
          <SchoolVerification userId={user.id} />
        </div>
      )}
    </main>
  )
}

function ProfileForm({
  userId,
  profile,
  university,
  next,
}: {
  userId: string
  profile: Tables<'profiles'> | null
  university: University
  next?: string
}) {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      nickname: profile?.nickname ?? '',
      major: profile?.major ?? '',
      universityId: university.id,
      bio: profile?.bio ?? '',
      skills: profile?.skills.join(', ') ?? '',
      interests: profile?.interests.join(', ') ?? '',
      preferredCategory: profile?.preferred_category ?? 'side_project',
      visibility: profile?.visibility ?? 'private',
    },
  })
  const errors = form.formState.errors
  const save = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      saveProfile(userId, { ...values, universityId: university.id }, Boolean(profile)),
    onSuccess: (saved) => {
      cache.setQueryData(profileKey(userId), saved)
      void cache.invalidateQueries({ queryKey: ['account', userId, 'view-profile'] })
      if (next) void navigate(next, { replace: true })
    },
  })
  const field = (name: keyof ProfileFormValues, hint = false) => ({
    ...form.register(name),
    id: name,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] || hint ? `${name}-help` : undefined,
  })
  return (
    <form
      className="panel flow"
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <Field id="nickname" label="닉네임" error={errors.nickname?.message}>
        <input className="input" maxLength={30} autoComplete="nickname" {...field('nickname')} />
      </Field>
      <div className="form-grid">
        <Field
          id="verified-school"
          label="소속 학교"
          hint="학교 Google 계정에서 확인된 정보로, 직접 변경할 수 없습니다."
        >
          <input
            className="input"
            id="verified-school"
            value={university.name}
            aria-describedby="verified-school-help"
            readOnly
          />
        </Field>
        <Field id="major" label="전공 또는 학과" error={errors.major?.message}>
          <input className="input" maxLength={80} {...field('major')} />
        </Field>
      </div>
      <Field id="bio" label="자기소개" error={errors.bio?.message}>
        <textarea className="input" rows={4} maxLength={1000} {...field('bio')} />
      </Field>
      <Field
        id="interests"
        label="관심 분야"
        hint="예: 사용자 조사, 접근성"
        error={errors.interests?.message}
      >
        <input className="input" maxLength={500} {...field('interests', true)} />
      </Field>
      <Field
        id="skills"
        label="보유 역량"
        hint="쉼표로 구분해 입력하세요. 예: React, 디자인"
        error={errors.skills?.message}
      >
        <input className="input" maxLength={500} {...field('skills', true)} />
      </Field>
      <Field
        id="preferredCategory"
        label="희망 프로젝트 유형"
        error={errors.preferredCategory?.message}
      >
        <select className="input" {...field('preferredCategory')}>
          {categories.map((item) => (
            <option key={item} value={item}>
              {categoryLabels[item]}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="visibility"
        label="프로필 공개 범위"
        hint="비공개라도 프로젝트 팀원에게는 닉네임과 프로젝트 역할만 보입니다."
        error={errors.visibility?.message}
      >
        <select className="input" {...field('visibility', true)}>
          <option value="private">비공개</option>
          <option value="public">전체 공개</option>
        </select>
      </Field>
      {save.error && (
        <Notice kind="error">
          {userError(save.error, '프로필을 저장하지 못했습니다. 다시 시도해 주세요.')}
        </Notice>
      )}
      {save.isSuccess && !next && <Notice kind="success">프로필을 저장했습니다.</Notice>}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? '저장 중…' : '프로필 저장'}
      </Button>
    </form>
  )
}
