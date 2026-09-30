import { Clock } from 'lucide-react'
import { useGetTimelineQuery } from '@/store/api/documentsApi'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBox } from '@/components/common/ErrorBox'
import { formatDate, fromNow } from '@/utils/format'

/** Plain sentences about what happened to this document. */
export function TimelineSection({ workspaceId, documentId }) {
  const { data: items = [], isLoading, error, refetch } = useGetTimelineQuery({ workspaceId, documentId })

  if (isLoading) return <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
  if (error) return <ErrorBox error={error} onRetry={refetch} />
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>

  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span className="absolute top-1.5 -left-[1.6rem] flex size-4 items-center justify-center rounded-full border bg-card">
            <Clock className="size-2.5 text-muted-foreground" />
          </span>
          <p className="text-sm">{it.message || it.action}</p>
          <p className="text-xs text-muted-foreground">
            {it.actor?.display_name ? `${it.actor.display_name} · ` : ''}{fromNow(it.created_at)} · {formatDate(it.created_at, 'D MMM YYYY, h:mm A')}
          </p>
        </li>
      ))}
    </ol>
  )
}
