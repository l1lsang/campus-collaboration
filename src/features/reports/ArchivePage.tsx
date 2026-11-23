import { useInfiniteQuery } from '@tanstack/react-query'
import { Loading, Notice, PageHeading } from '../../components/common/states'
import { Button } from '../../components/ui/button'
import {
  archiveKey,
  archivePageSize,
  listArchive,
  reportDate,
  reportKinds,
  type ArchiveEntry,
} from './reports-api'

const publicSections = [
  ['results', '공개 결과'],
  ['lessons', '공개 교훈'],
  ['handoff', '공개 인수인계'],
] as const

function ArchiveCard({ entry }: { entry: ArchiveEntry }) {
  return (
    <article id={`archive-${entry.id}`} className="panel flow">
      <header>
        <span className="chip">{reportKinds[entry.kind]}</span>
        <h2>{entry.title}</h2>
        <time className="muted" dateTime={entry.publishedAt}>
          {reportDate(entry.publishedAt)}
        </time>
      </header>
      <p className="preserve-text">{entry.summary}</p>
      {publicSections.map(
        ([key, label]) =>
          entry[key] && (
            <section key={key}>
              <h3>{label}</h3>
              <p className="preserve-text">{entry[key]}</p>
            </section>
          ),
      )}
    </article>
  )
}

export function ArchivePage() {
  const archive = useInfiniteQuery({
    queryKey: archiveKey,
    queryFn: ({ pageParam }) => listArchive(pageParam),
    initialPageParam: null as Pick<ArchiveEntry, 'publishedAt' | 'id'> | null,
    getNextPageParam: (page) => (page.length === archivePageSize ? page.at(-1) : undefined),
    gcTime: 0,
    retry: false,
  })
  const entries = archive.data?.pages.flat() ?? []
  return (
    <main className="container page" id="main-content">
      <PageHeading
        title="프로젝트 아카이브"
        description="프로젝트 소유자가 확인하고 공개한 문안입니다. 팀 내부 초안과 원본 기록은 공개하지 않습니다."
      />
      {archive.isPending ? (
        <Loading />
      ) : archive.isError && !archive.data ? (
        <Notice kind="error">
          아카이브를 불러오지 못했습니다.{' '}
          <button type="button" className="text-link" onClick={() => void archive.refetch()}>
            다시 시도
          </button>
        </Notice>
      ) : entries.length === 0 ? (
        <Notice>아직 공개된 보고서가 없습니다.</Notice>
      ) : (
        <div className="flow">
          {entries.map((entry) => (
            <ArchiveCard key={entry.id} entry={entry} />
          ))}
          {archive.isFetchNextPageError && (
            <Notice kind="error">다음 목록을 불러오지 못했습니다.</Notice>
          )}
          {archive.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => void archive.fetchNextPage()}
              disabled={archive.isFetching}
            >
              {archive.isFetchingNextPage ? '불러오는 중…' : '공개 보고서 더 보기'}
            </Button>
          )}
        </div>
      )}
    </main>
  )
}
