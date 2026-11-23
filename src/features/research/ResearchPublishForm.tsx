import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Field, Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useMyProjects } from '../projects/project-api'
import { ResearchAccountError } from './ResearchWork'
import {
  publishResearchRecruitment,
  safeTestUrl,
  useResearchCredits,
  useResearchMutation,
  type ResearchKind,
} from './research-api'

export function ResearchPublishForm({ userId }: { userId: string }) {
  const projects = useMyProjects(userId)
  const credits = useResearchCredits(userId)
  const publish = useResearchMutation(userId, publishResearchRecruitment)
  const navigate = useNavigate()
  const request = useRef<{ id: string; key: string } | null>(null)
  const [kind, setKind] = useState<ResearchKind>('project_test')
  const [capacity, setCapacity] = useState('1')
  const [reward, setReward] = useState('1')
  const [validation, setValidation] = useState<string | null>(null)
  const cost = Number(capacity) * Number(reward)
  const owners = projects.isError
    ? []
    : (projects.data?.filter((project) => project.membership_role === 'owner') ?? [])
  const isSurvey = kind === 'survey'
  const projectRequired = !isSurvey && !owners.length

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (publish.isPending || projectRequired) return
    const data = new FormData(event.currentTarget)
    const text = (field: string) => String(data.get(field) ?? '').trim()
    const testUrl = safeTestUrl(String(data.get('testUrl') ?? ''))
    const title = text('title')
    const description = text('description')
    const projectId = text('projectId')
    if (!testUrl || Array.from(title).length < 2 || Array.from(description).length < 10) {
      setValidation('제목 2자, 소개 10자 이상과 유효한 HTTPS 링크를 입력해 주세요.')
      return
    }
    if ((!isSurvey || projectId) && !owners.some((project) => project.id === projectId)) {
      setValidation('본인이 소유한 프로젝트를 선택해 주세요.')
      return
    }
    setValidation(null)
    const input = {
      ...(isSurvey ? { kind, projectId: projectId || null } : { kind, projectId }),
      title,
      description,
      testUrl,
      capacity: Number(capacity),
      reward: Number(reward),
    }
    const key = JSON.stringify(input)
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    try {
      await publish.mutateAsync({ ...input, requestId: request.current.id })
      void navigate('/research/mine', { replace: true })
    } catch {
      // Keep the request ID for a retry of this payload and display the mutation error.
    }
  }

  if (credits.isPending) return <Loading />
  if (credits.isError)
    return (
      <ResearchAccountError
        error={credits.error}
        fallback="크레딧을 불러오지 못했습니다."
        next="/research/new"
        retry={() => void credits.refetch()}
      />
    )

  return (
    <form className="panel flow" onSubmit={(event) => void onSubmit(event)}>
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={publish.isPending}>
        <legend className="mb-2 font-semibold">모집 유형</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="kind"
              value="project_test"
              checked={!isSurvey}
              onChange={() => setKind('project_test')}
            />
            프로젝트 테스트
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="kind"
              value="survey"
              checked={isSurvey}
              onChange={() => setKind('survey')}
            />
            외부 설문
          </label>
        </div>
      </fieldset>
      <p className="muted">
        제목과 소개는 공개되며 링크는 신청한 참여자에게만 표시됩니다. 공개 소개에 개인정보나 비공개
        프로젝트 자료를 넣지 마세요.
      </p>
      {projects.isPending ? (
        <Loading label="내 프로젝트를 불러오는 중…" />
      ) : projects.isError ? (
        <ResearchAccountError
          error={projects.error}
          fallback={
            isSurvey
              ? '프로젝트 목록을 불러오지 못했지만 연결 없이 설문을 게시할 수 있습니다.'
              : '프로젝트를 불러오지 못했습니다.'
          }
          next="/research/new"
          retry={() => void projects.refetch()}
        />
      ) : projectRequired ? (
        <Notice>
          프로젝트 테스트는 소유한 프로젝트가 필요합니다.{' '}
          <Link className="text-link" to="/projects/new">
            프로젝트 만들기
          </Link>{' '}
          또는 프로젝트 없이 외부 설문을 등록할 수 있습니다.
        </Notice>
      ) : null}
      <fieldset
        className="flow m-0 min-w-0 border-0 p-0"
        disabled={projectRequired || publish.isPending}
      >
        <legend className="sr-only">모집 상세</legend>
        <Field id="research-project" label={isSurvey ? '프로젝트 (선택)' : '내 프로젝트'}>
          <select
            id="research-project"
            name="projectId"
            className="input"
            required={!isSurvey}
            defaultValue=""
          >
            <option value="" disabled={!isSurvey}>
              {isSurvey ? '프로젝트 연결 안 함' : '프로젝트 선택'}
            </option>
            {owners.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </Field>
        <Field id="research-title" label="모집 제목">
          <input
            id="research-title"
            name="title"
            className="input"
            required
            minLength={2}
            maxLength={100}
          />
        </Field>
        <Field id="research-description" label="공개 소개 및 참여 안내">
          <textarea
            id="research-description"
            name="description"
            className="input"
            rows={4}
            required
            minLength={10}
            maxLength={2000}
          />
        </Field>
        <Field
          id="research-url"
          label={isSurvey ? '설문 응답 링크 (HTTPS)' : '테스트 링크 (HTTPS)'}
          hint={
            isSurvey
              ? 'Google Forms, 네이버 폼 등 참여자가 응답할 수 있는 주소를 붙여 넣으세요. 답변은 이 서비스에서 수집하지 않습니다.'
              : undefined
          }
        >
          <input
            id="research-url"
            name="testUrl"
            className="input"
            type="url"
            placeholder="https://"
            aria-describedby={isSurvey ? 'research-url-help' : undefined}
            required
            maxLength={2000}
          />
        </Field>
        {isSurvey && (
          <p className="muted text-sm">
            프로젝트에 연결하지 않는 설문은 외부 폼에 ‘참여 확인 코드’ 필수 질문을 추가하세요. 보상
            확인용으로 이름이나 이메일을 수집하지 말고, 신고 목록의 코드를 외부 폼 응답과 직접
            대조하세요.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="research-capacity" label="모집 인원 (1~20명)">
            <input
              id="research-capacity"
              className="input"
              type="number"
              min={1}
              max={20}
              required
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </Field>
          <Field id="research-reward" label="1인당 보상 (1~10 크레딧)">
            <input
              id="research-reward"
              className="input"
              type="number"
              min={1}
              max={10}
              required
              value={reward}
              onChange={(event) => setReward(event.target.value)}
            />
          </Field>
        </div>
        <p>
          게시 시 <strong>{cost} 크레딧 예약</strong> · 현재 사용 가능 {credits.data.available}{' '}
          크레딧. 진행자가 확인한 참여에만 보상이 지급됩니다.
        </p>
        {cost > credits.data.available && (
          <Notice>사용 가능한 크레딧이 부족합니다. 모집 인원이나 보상을 줄여 주세요.</Notice>
        )}
        {validation && <Notice kind="error">{validation}</Notice>}
        {publish.error && (
          <ResearchAccountError
            error={publish.error}
            fallback="모집을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요."
            next="/research/new"
          />
        )}
        <Button
          type="submit"
          disabled={publish.isPending || (cost > credits.data.available && !publish.isError)}
        >
          {publish.isPending ? '등록 중…' : '크레딧 예약하고 게시'}
        </Button>
      </fieldset>
    </form>
  )
}
