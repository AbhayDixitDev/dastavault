import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DocumentThumb } from './DocumentThumb'
import { loadOptional, OPTIONAL } from '@/services/search/optional'
import { whyMatched, highlightParts } from '@/services/search/matched'
import { typeLabel } from '@/services/search/documentTypes'
import { formatDate } from '@/utils/format'
import { cn } from '@/lib/utils'

let cachedCard = undefined

/** Loads the documents agent's DocumentCard when it exists; null otherwise. */
export function useDocumentCard() {
  const [Card, setCard] = useState(cachedCard === undefined ? null : cachedCard)
  useEffect(() => {
    if (cachedCard !== undefined) return
    let alive = true
    loadOptional(OPTIONAL.documentCard).then((mod) => {
      cachedCard = mod?.DocumentCard ?? mod?.default ?? null
      if (alive) setCard(() => cachedCard)
    })
    return () => {
      alive = false
    }
  }, [])
  return Card
}

export function documentHref(workspaceId, doc, result) {
  const isNote = result?.kind === 'note' || doc?.document_type === 'note' || doc?.kind === 'note'
  return isNote ? `/w/${workspaceId}/notes/${doc.id}` : `/w/${workspaceId}/documents/${doc.id}`
}

/** Compact fallback card used when DocumentCard is not available. */
export function CompactDocumentCard({ document: doc, workspaceId, href, className, types, children }) {
  const isNote = doc?.document_type === 'note' || doc?.kind === 'note'
  const people = Array.isArray(doc?.people) ? doc.people : []
  const expiry = doc?.expiry_date
  return (
    <Link
      to={href ?? documentHref(workspaceId, doc)}
      className={cn('flex gap-3 rounded-2xl border bg-card p-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 outline-none', className)}
    >
      <DocumentThumb workspaceId={workspaceId} fileId={doc?.thumbnail_file_id} kind={isNote ? 'note' : undefined} className="size-16" alt="" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium">{doc?.name || 'Untitled'}</p>
          {doc?.document_type && (
            <Badge variant="secondary" className="shrink-0">
              {typeLabel(doc.document_type, types)}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {[people.map((p) => p.display_name).filter(Boolean).join(', '), doc?.organisation].filter(Boolean).join(' - ') || (doc?.created_at ? `Added ${formatDate(doc.created_at)}` : '')}
        </p>
        {expiry && (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" /> Expires {formatDate(expiry)}
          </p>
        )}
        {children}
      </div>
    </Link>
  )
}

/**
 * One search result: the document card plus the plain-words match line and
 * a highlighted snippet.
 */
export function ResultCard({ result, workspaceId, query, resolved, people, types }) {
  const DocumentCard = useDocumentCard()
  const doc = result?.document
  if (!doc) return null
  const why = whyMatched(result, resolved, { people, types })
  const parts = highlightParts(result.snippet, { query, resolved })
  const byMeaning = Array.isArray(result.matched) && result.matched.includes('meaning')

  const info = (why || parts.length > 0) && (
    <div className="mt-1 space-y-1">
      {why && (
        <p className="flex items-center gap-1 text-xs text-primary">
          {byMeaning && <Sparkles className="size-3" aria-hidden="true" />}
          <span>{why}</span>
        </p>
      )}
      {parts.length > 0 && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {parts.map((p, i) =>
            p.hit ? (
              <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/30">
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>
      )}
    </div>
  )

  if (DocumentCard) {
    return (
      <div className="flex flex-col">
        <DocumentCard document={doc} workspaceId={workspaceId} />
        {info && <div className="px-1">{info}</div>}
      </div>
    )
  }

  return (
    <CompactDocumentCard document={doc} workspaceId={workspaceId} href={documentHref(workspaceId, doc, result)} types={types}>
      {info}
    </CompactDocumentCard>
  )
}
