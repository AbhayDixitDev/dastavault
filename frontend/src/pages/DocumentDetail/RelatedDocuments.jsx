import { Link } from 'react-router-dom'
import { useGetDocumentsQuery } from '@/store/api/documentsApi'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { documentTypeLabel } from '@/components/documents/documentTypes'
import { Skeleton } from '@/components/ui/skeleton'
import { fromNow } from '@/utils/format'

/** Up to six other documents for the same person (or of the same type). */
export function RelatedDocuments({ workspaceId, document: doc }) {
  const personId = doc?.people?.[0]?.id
  const args = personId ? { workspaceId, person_id: personId, limit: 7 } : { workspaceId, document_type: doc?.document_type, limit: 7 }
  const { data, isLoading } = useGetDocumentsQuery(args, { skip: !workspaceId || (!personId && !doc?.document_type) })
  const list = (data?.documents ?? []).filter((d) => d.id !== doc?.id).slice(0, 6)

  if (isLoading) return <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
  if (!list.length) return <p className="text-sm text-muted-foreground">No related documents yet.</p>

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((d) => (
        <li key={d.id}>
          <Link to={`/w/${workspaceId}/documents/${d.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-2.5 transition-colors hover:bg-accent/60">
            <DocumentTypeIcon type={d.document_type} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{d.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{documentTypeLabel(d.document_type)} · {fromNow(d.created_at)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
