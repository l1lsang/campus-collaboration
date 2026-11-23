import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Field, Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { useMyProjects } from '../projects/project-api'
import { ResearchAccountError } from './ResearchWork'
import {
  publishResearchTest,
  researchError,
  safeTestUrl,
  useResearchCredits,
  useResearchMutation,
} from './research-api'

export function ResearchPublishForm({ userId }: { userId: string }) {
  const projects = useMyProjects(userId)
  const credits = useResearchCredits(userId)
  const publish = useResearchMutation(userId, publishResearchTest)
  const navigate = useNavigate()
  const request = useRef<{ id: string; key: string } | null>(null)
  const [capacity, setCapacity] = useState('1')
  const [reward, setReward] = useState('1')
  const [validation, setValidation] = useState<string | null>(null)
  const cost = Number(capacity) * Number(reward)
  const owners = projects.data?.filter((project) => project.membership_role === 'owner') ?? []

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (publish.isPending) return
    const data = new FormData(event.currentTarget)
    const text = (field: string) => String(data.get(field) ?? '').trim()
    const testUrl = safeTestUrl(text('testUrl'))
    const title = text('title')
    const description = text('description')
    if (!testUrl || Array.from(title).length < 2 || Array.from(description).length < 10) {
      setValidation('제목 2자, 소개 10자 이상과 유효한 HTTPS 링크를 입력해 주세요.')
      return
    }
    setValidation(null)
    const input = {
      projectId: text('projectId'),
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

  if (projects.isPending || credits.isPending) return <Loading />
  if (credits.isError)
    return (
      <ResearchAccountError
        error={credits.error}
        fallback="크레딧을 불러오지 못했습니다."
        retry={() => void credits.refetch()}
      />
    )
  if (projects.isError)
    return (
      <ResearchAccountError
        error={projects.error}
        fallback="프로젝트를 불러오지 못했습니다."
        retry={() => void projects.refetch()}
      />
    )
  if (!owners.length)
    return (
      <Notice>
        모집을 등록하려면 소유한 프로젝트가 필요합니다.{' '}
        <Link className="text-link" to="/projects/new">
          프로젝트 만들기
        </Link>
      </Notice>
    )

  return (
    <form className="panel flow" onSubmit={(event) => void onSubmit(event)}>
      <Notice>
        모집 제목과 소개는 공개되며 테스트 링크는 신청자에게만 표시됩니다. 공개 설명에 회원정보나
        비공개 자료를 담지 마세요.
      </Notice>
      <Field id="research-project" label="내 프로젝트">
        <select id="research-project" name="projectId" className="input" required defaultValue="">
          <option value="" disabled>
            프로젝트 선택
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
      <Field id="research-url" label="테스트 링크 (HTTPS)">
        <input
          id="research-url"
          name="testUrl"
          className="input"
          type="url"
          placeholder="https://"
          required
          maxLength={2000}
        />
      </Field>
      <div className="form-grid">
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
        게시 시 <strong>{cost} 크레딧 예약</strong> · 현재 사용 가능 {credits.data.available} 크레딧
      </p>
      {cost > credits.data.available && (
        <Notice>사용 가능한 크레딧이 부족합니다. 모집 인원이나 보상을 줄여 주세요.</Notice>
      )}
      {validation && <Notice kind="error">{validation}</Notice>}
      {publish.error && (
        <Notice kind="error">
          {researchError(publish.error, '모집을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
        </Notice>
      )}
      <Button
        type="submit"
        disabled={publish.isPending || (cost > credits.data.available && !publish.isError)}
      >
        {publish.isPending ? '등록 중…' : '크레딧 예약하고 게시'}
      </Button>
    </form>
  )
}
