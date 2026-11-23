import { Link, useParams } from 'react-router'
import { z } from 'zod'
import { Loading, Notice, PageHeading } from '../../components/common/states'
import { categoryLabel } from '../../lib/constants/brand'
import { useAuth } from '../auth/auth-provider'
import { usePublicProfile, useUniversities } from './profile-api'

export function ProfilePage() {
  const { id } = useParams()
  const { session, loading } = useAuth()
  if (loading)
    return (
      <div className="container page">
        <Loading />
      </div>
    )
  if (!z.uuid().safeParse(id).success || !id)
    return (
      <main className="narrow page" id="main-content">
        <Notice kind="error">유효한 프로필 주소가 아닙니다.</Notice>
      </main>
    )
  return <ProfileDetails id={id} userId={session?.user.id} />
}

function ProfileDetails({ id, userId }: { id: string; userId?: string }) {
  const query = usePublicProfile(id, userId)
  const universities = useUniversities()
  const profile = query.data
  const school = universities.data?.find((item) => item.id === profile?.university_id)
  return (
    <main className="narrow page" id="main-content">
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Notice kind="error">프로필을 불러오지 못했습니다.</Notice>
      ) : !profile ? (
        <Notice>프로필이 없거나 공개되지 않았습니다.</Notice>
      ) : (
        <>
          <PageHeading
            label="학생 프로필"
            title={profile.nickname}
            description={[school?.name, profile.major].filter(Boolean).join(' · ')}
          />
          <section className="panel flow">
            <h2>자기소개</h2>
            <p className="preserve-text">{profile.bio}</p>
            <h2>보유 역량</h2>
            <div className="wrap">
              {profile.skills.map((item) => (
                <span className="chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <h2>관심 분야</h2>
            <div className="wrap">
              {profile.interests.map((item) => (
                <span className="chip" key={item}>
                  {item}
                </span>
              ))}
            </div>
            <p className="muted">희망 프로젝트: {categoryLabel(profile.preferred_category)}</p>
            {id === userId && (
              <Link className="text-link" to="/settings">
                프로필 수정
              </Link>
            )}
          </section>
        </>
      )}
    </main>
  )
}
