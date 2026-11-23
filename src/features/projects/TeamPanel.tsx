import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2 } from 'lucide-react'
import { Field, Loading, Notice } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import { userError } from '../../lib/supabase/errors'
import { createInvite, invitesKey, revokeInvite, useInvites, useRoster } from './project-api'

const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
const statuses: Record<string, string> = {
  active: '사용 가능',
  accepted: '수락됨',
  revoked: '취소됨',
  expired: '만료됨',
}

export function TeamPanel({
  projectId,
  userId,
  isOwner,
}: {
  projectId: string
  userId: string
  isOwner: boolean
}) {
  const roster = useRoster(projectId, userId)
  return (
    <div className="flow team-stack">
      <section className="panel flow" aria-label="팀원 목록">
        <h2>팀원</h2>
        {roster.isPending ? (
          <Loading />
        ) : roster.isError ? (
          <Notice kind="error">
            팀원 목록을 불러오지 못했습니다.{' '}
            <button className="text-link" onClick={() => void roster.refetch()}>
              다시 시도
            </button>
          </Notice>
        ) : (
          <ul className="divided-list">
            {roster.data.map((member) => (
              <li key={member.membership_id} className="split-row">
                <span className="member-name">
                  <span className="avatar-mark" aria-hidden="true">
                    {member.nickname?.slice(0, 1) ?? '?'}
                  </span>
                  <strong>{member.nickname ?? '등록된 닉네임 없음'}</strong>
                </span>
                <span className="chip">{member.membership_role === 'owner' ? '팀장' : '팀원'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {isOwner && <InvitePanel projectId={projectId} userId={userId} />}
    </div>
  )
}

function InvitePanel({ projectId, userId }: { projectId: string; userId: string }) {
  const cache = useQueryClient()
  const query = useInvites(projectId, userId)
  const [link, setLink] = useState<{ id: string; url: string } | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'failure'>('idle')
  const refresh = () => cache.invalidateQueries({ queryKey: invitesKey(projectId, userId) })
  const create = useMutation({
    mutationFn: () => createInvite(projectId),
    onSuccess: (invite) => {
      if (invite)
        setLink({ id: invite.invite_id, url: `${window.location.origin}/invite#${invite.token}` })
      setCopyStatus('idle')
      void refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: revokeInvite,
    onSuccess: (_, id) => {
      if (link?.id === id) {
        setLink(null)
        create.reset()
      }
      void refresh()
    },
    onError: () => {
      void refresh()
    },
  })
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopyStatus('success')
    } catch {
      setCopyStatus('failure')
    }
  }
  return (
    <section className="panel flow" aria-label="팀원 초대">
      <div className="section-heading">
        <div>
          <h2>팀원 초대</h2>
          <p className="muted">
            링크 한 개당 한 명만 참여할 수 있습니다. 링크는 7일 후 만료됩니다.
          </p>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          <Link2 size={18} aria-hidden="true" />
          {create.isPending ? '만드는 중…' : '초대 링크 만들기'}
        </Button>
      </div>
      {create.error && (
        <Notice kind="error">{userError(create.error, '초대 링크를 만들지 못했습니다.')}</Notice>
      )}
      {revoke.error && (
        <Notice kind="error">{userError(revoke.error, '초대를 취소하지 못했습니다.')}</Notice>
      )}
      {link && (
        <div className="invite-result flow">
          <Field
            id="invite-link"
            label="초대 링크 주소"
            hint="새로고침하면 주소를 다시 볼 수 없습니다. 초대할 사람에게만 전달하세요."
          >
            <input
              id="invite-link"
              className="input"
              readOnly
              value={link.url}
              aria-describedby="invite-link-help"
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
          <Button variant="outline" onClick={() => void copy(link.url)}>
            {copyStatus === 'success' ? (
              <Check size={17} aria-hidden="true" />
            ) : (
              <Copy size={17} aria-hidden="true" />
            )}
            {copyStatus === 'success' ? '복사했어요' : '링크 복사'}
          </Button>
          {copyStatus === 'failure' && (
            <Notice>자동으로 복사하지 못했습니다. 위 주소를 선택해 직접 복사하세요.</Notice>
          )}
        </div>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice kind="error">
          초대 목록을 불러오지 못했습니다.{' '}
          <button className="text-link" onClick={() => void query.refetch()}>
            다시 시도
          </button>
        </Notice>
      ) : query.data.length ? (
        <ul className="divided-list">
          {query.data.map((invite) => (
            <li className="split-row" key={invite.id}>
              <div>
                <strong>{statuses[invite.status] ?? '알 수 없음'}</strong>
                <p className="field-hint">
                  {dateTime.format(new Date(invite.created_at))} 생성 ·{' '}
                  {dateTime.format(new Date(invite.expires_at))} 만료
                </p>
              </div>
              {invite.status === 'active' && (
                <Button
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invite.id)}
                >
                  초대 취소
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">아직 만든 초대가 없습니다.</p>
      )}
    </section>
  )
}
