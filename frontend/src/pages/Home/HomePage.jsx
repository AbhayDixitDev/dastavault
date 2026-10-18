import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight, ImageIcon, Mic, Plus, Search } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetDocumentsQuery } from '@/store/api/documentsApi'
import { useGetHomeQuery } from '@/store/api/homeApi'
import { Skeleton } from '@/components/ui/skeleton'
import { SignedImage } from '@/components/documents/SignedImage'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { documentTypeInfo } from '@/components/documents/documentTypes'
import { PersonAvatar } from '@/components/people/PersonAvatar'
import { ContinueScanBanner } from '@/components/scanner/ContinueScanBanner'
import { ContinueUploadBanner } from '@/components/documents/ContinueUploadBanner'
import { pickThumbnailFile } from '@/services/files'
import { cn } from '@/lib/utils'

const DAY = 24 * 60 * 60 * 1000

/** "Today", "Yesterday", "This week", else the month: like a photo timeline. */
function dateGroup(iso, now = new Date()) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Earlier'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (d.getTime() >= startOfToday) return 'Today'
  if (d.getTime() >= startOfToday - DAY) return 'Yesterday'
  if (d.getTime() >= startOfToday - 6 * DAY) return 'This week'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function Tile({ doc, workspaceId }) {
  const thumb = pickThumbnailFile(doc.files)
  return (
    <Link to={`/w/${workspaceId}/documents/${doc.id}`} className="group block min-w-0">
      <SignedImage
        workspaceId={workspaceId}
        fileId={thumb?.id}
        className="aspect-square w-full rounded-lg bg-muted"
        imgClassName="size-full object-cover transition group-active:scale-[0.98]"
        fallback={(
          <div className={cn('flex size-full items-center justify-center', documentTypeInfo(doc.document_type).color)}>
            <DocumentTypeIcon type={doc.document_type} size="lg" className="bg-transparent" />
          </div>
        )}
      />
      <span className="mt-1 block truncate text-xs">{doc.name}</span>
    </Link>
  )
}

/**
 * Home, like a photo app: search first, the people, then every document as
 * a grid by date. Nothing else.
 */
export function HomePage() {
  const { workspaceId, terminology: t } = useWorkspace()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data: home } = useGetHomeQuery(workspaceId, { skip: !workspaceId })
  const { data, isLoading } = useGetDocumentsQuery({ workspaceId, limit: 60, sort: 'created_at', order: 'desc' }, { skip: !workspaceId })
  const docs = useMemo(() => data?.documents ?? [], [data])
  const expiring = home?.expiring ?? []

  const groups = useMemo(() => {
    const map = new Map()
    for (const d of docs) {
      const key = dateGroup(d.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(d)
    }
    return [...map.entries()]
  }, [docs])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link
        to="search"
        className="flex items-center gap-3 rounded-full border bg-card px-4 py-3 text-sm text-muted-foreground shadow-soft transition hover:border-foreground/20"
      >
        <Search className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search a name, “passport”, any text</span>
        <Mic className="size-5 shrink-0" />
        <ImageIcon className="size-5 shrink-0" />
      </Link>

      <ContinueScanBanner workspaceId={workspaceId} />
      <ContinueUploadBanner workspaceId={workspaceId} />

      {people.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t.person_label_plural}</h2>
            <Link to="people" className="flex items-center text-xs text-muted-foreground">All <ChevronRight className="size-3.5" /></Link>
          </div>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {people.slice(0, 8).map((p) => (
              <Link key={p.id} to={`people/${p.id}`} className="flex min-w-0 flex-col items-center gap-1 text-center">
                <PersonAvatar person={p} className="size-16 border" />
                <span className="w-full truncate text-xs">{p.display_name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {expiring.length > 0 && (
        <Link to="documents?expiring_days=90" className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
          <CalendarClock className="size-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 truncate">{expiring.length} {expiring.length === 1 ? 'document expires' : 'documents expire'} soon</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      )}

      {isLoading && (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
        </div>
      )}

      {!isLoading && docs.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <p className="font-medium text-foreground">No documents yet</p>
          <p className="max-w-xs text-sm">Scan a paper or add photos and files. They show up here.</p>
          <Link to="upload" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            <Plus className="size-4" /> Add documents
          </Link>
        </div>
      )}

      {groups.map(([label, list]) => (
        <section key={label}>
          <h2 className="mb-2 text-sm font-semibold">{label}</h2>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            {list.map((d) => <Tile key={d.id} doc={d} workspaceId={workspaceId} />)}
          </div>
        </section>
      ))}

      {data?.next_cursor && (
        <Link to="documents" className="self-center rounded-full border px-4 py-2 text-sm">All documents</Link>
      )}
    </div>
  )
}
