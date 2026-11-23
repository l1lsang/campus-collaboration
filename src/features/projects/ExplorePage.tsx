import { useState } from 'react'
import { Search } from 'lucide-react'
import { Loading, Notice, PageHeading, Unconfigured } from '../../components/common/states'
import { categories, categoryLabels } from '../../lib/constants/brand'
import { isSupabaseConfigured } from '../../lib/supabase/client'
import { ProjectCard } from './ProjectCard'
import { usePublicProjects } from './project-api'

export function ExplorePage() {
  const projects = usePublicProjects()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const keyword = query.trim().toLocaleLowerCase('ko')
  const results = (projects.data ?? []).filter(
    (item) =>
      (!category || item.category === category) &&
      `${item.title}\n${item.description}`.toLocaleLowerCase('ko').includes(keyword),
  )
  return (
    <main className="container page" id="main-content">
      <PageHeading
        label="프로젝트 탐색"
        title="다른 캠퍼스의 프로젝트"
        description="학생들이 공개한 프로젝트를 제목과 소개, 유형으로 찾아보세요."
      />
      {!isSupabaseConfigured ? (
        <Unconfigured />
      ) : (
        <>
          <div className="panel search-panel">
            <div className="field">
              <label htmlFor="project-search">키워드</label>
              <div className="search-input">
                <Search size={19} aria-hidden="true" />
                <input
                  id="project-search"
                  className="input"
                  type="search"
                  placeholder="프로젝트 이름 또는 소개"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={100}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="project-category">프로젝트 유형</label>
              <select
                className="input"
                id="project-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">모든 유형</option>
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {categoryLabels[item]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <section className="section-gap flow" aria-label="검색 결과">
            {projects.isPending ? (
              <Loading />
            ) : projects.isError ? (
              <Notice kind="error">
                프로젝트를 불러오지 못했습니다.{' '}
                <button className="text-link" onClick={() => void projects.refetch()}>
                  다시 시도
                </button>
              </Notice>
            ) : (
              <>
                <p className="result-count" aria-live="polite">
                  검색 결과 {results.length}개 <span>· 최근 공개 프로젝트 최대 100개 기준</span>
                </p>
                {results.length ? (
                  <ul className="project-list">
                    {results.map((project) => (
                      <ProjectCard key={project.id} project={project} />
                    ))}
                  </ul>
                ) : (
                  <div className="panel empty-state">
                    <Search size={23} aria-hidden="true" />
                    <div>
                      <strong>
                        {keyword || category
                          ? '조건에 맞는 프로젝트가 없어요.'
                          : '아직 공개된 프로젝트가 없어요.'}
                      </strong>
                      <p>
                        {keyword || category
                          ? '다른 키워드나 유형으로 검색해 보세요.'
                          : '프로젝트가 공개되면 여기에 표시됩니다.'}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  )
}
