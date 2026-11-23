import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Field, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { categories, categoryLabels } from '../../lib/constants/brand'
import { projectSchema, type ProjectFormValues } from '../../lib/validations/forms'
import { userError } from '../../lib/supabase/errors'
import { useAuth } from '../auth/auth-provider'
import { SchoolVerification } from '../universities/SchoolVerification'
import { createProject, myProjectsKey, publicProjectsKey, projectKey } from './project-api'

export function CreateProjectPage() {
  const user = useAuth().session!.user
  return (
    <main className="narrow page" id="main-content">
      <Link className="back-link" to="/dashboard">
        <ArrowLeft size={16} aria-hidden="true" /> 대시보드
      </Link>
      <PageHeading
        label="팀플로그"
        title="새 프로젝트"
        description="팀이 함께 해결하고 싶은 문제부터 적어 보세요."
      />
      <SchoolVerification userId={user.id} email={user.email}>
        <ProjectForm userId={user.id} />
      </SchoolVerification>
    </main>
  )
}

function ProjectForm({ userId }: { userId: string }) {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'side_project',
      visibility: 'private',
      startDate: '',
      dueDate: '',
    },
  })
  const errors = form.formState.errors
  const create = useMutation({
    mutationFn: createProject,
    onSuccess: (id) => {
      void cache.invalidateQueries({ queryKey: myProjectsKey(userId) })
      void cache.invalidateQueries({ queryKey: publicProjectsKey })
      void cache.invalidateQueries({ queryKey: projectKey(userId, id) })
      void navigate(`/projects/${id}`, { replace: true })
    },
  })
  const field = (name: keyof ProjectFormValues, hint = false) => ({
    ...form.register(name),
    id: name,
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] || hint ? `${name}-help` : undefined,
  })
  return (
    <form
      className="panel flow"
      noValidate
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
    >
      <Field id="title" label="프로젝트 이름" error={errors.title?.message}>
        <input className="input" maxLength={100} {...field('title')} />
      </Field>
      <Field id="description" label="프로젝트 소개" error={errors.description?.message}>
        <textarea className="input" rows={5} maxLength={4000} {...field('description')} />
      </Field>
      <div className="form-grid">
        <Field id="category" label="프로젝트 유형" error={errors.category?.message}>
          <select className="input" {...field('category')}>
            {categories.map((item) => (
              <option key={item} value={item}>
                {categoryLabels[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="visibility"
          label="공개 범위"
          error={errors.visibility?.message}
          hint="공개로 설정하면 프로젝트 이름과 소개, 일정이 방문자에게 보입니다."
        >
          <select className="input" {...field('visibility', true)}>
            <option value="private">팀원만 보기</option>
            <option value="public">전체 공개</option>
          </select>
        </Field>
      </div>
      <div className="form-grid">
        <Field id="startDate" label="시작일 (선택)" error={errors.startDate?.message}>
          <input className="input" type="date" {...field('startDate')} />
        </Field>
        <Field id="dueDate" label="목표 종료일 (선택)" error={errors.dueDate?.message}>
          <input className="input" type="date" {...field('dueDate')} />
        </Field>
      </div>
      {create.error && (
        <Notice kind="error">
          {userError(create.error, '프로젝트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')}
        </Notice>
      )}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? '만드는 중…' : '프로젝트 만들기'}
      </Button>
    </form>
  )
}
