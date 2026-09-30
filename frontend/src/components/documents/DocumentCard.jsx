import { Link } from 'react-router-dom'
import { Star, Clock } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { initials, fromNow } from '@/utils/format'
import { pickThumbnailFile } from '@/services/files'
import { cn } from '@/lib/utils'
import { DocumentTypeIcon } from './DocumentTypeIcon'
import { documentTypeLabel, documentTypeInfo } from './documentTypes'
import { ExpiryChip } from './ExpiryChip'
import { SignedImage } from './SignedImage'

function PeopleAvatars({ people = [], max = 3 }) {
  if (!people.length) return null
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <span className="flex -space-x-1.5" title={people.map((p) => p.display_name).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.id} className="size-6 border-2 border-card text-[10px]">
          <AvatarFallback>{initials(p.display_name)}</AvatarFallback>
        </Avatar>
      ))}
      {extra > 0 && (
        <span className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium">+{extra}</span>
      )}
    </span>
  )
}

function Placeholder({ type }) {
  const info = documentTypeInfo(type)
  return (
    <div className={cn('flex size-full items-center justify-center', info.color)}>
      <DocumentTypeIcon type={type} size="lg" className="bg-transparent" />
    </div>
  )
}

function FavouriteButton({ on, onToggle, className }) {
  if (!onToggle) return on ? <Star className={cn('size-4 fill-amber-400 text-amber-400', className)} /> : null
  return (
    <button
      type="button"
      aria-label={on ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={on}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      className={cn('tap-target flex items-center justify-center rounded-full transition-colors', on ? 'text-amber-400' : 'text-muted-foreground/70 hover:text-amber-400', className)}
    >
      <Star className={cn('size-5', on && 'fill-current')} />
    </button>
  )
}

/**
 * One document in the list. `view` is 'grid' or 'list'.
 * `onToggleFavourite(doc)` is optional; when missing the star is read-only.
 */
export function DocumentCard({ document: doc, workspaceId, view = 'grid', onToggleFavourite, to }) {
  const thumb = pickThumbnailFile(doc.files)
  const href = to ?? `/w/${workspaceId}/documents/${doc.id}`
  const processing = doc.status === 'processing'
  const failed = doc.status === 'failed'

  if (view === 'list') {
    return (
      <Link to={href} className="flex items-center gap-3 rounded-2xl border bg-card p-3 transition-colors hover:bg-accent/60">
        <SignedImage workspaceId={workspaceId} fileId={thumb?.id} alt="" className="size-14 shrink-0 rounded-xl bg-muted" fallback={<Placeholder type={doc.document_type} />} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{doc.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{documentTypeLabel(doc.document_type)}</span>
            {doc.page_count > 1 && <span>· {doc.page_count} pages</span>}
            <span>· {fromNow(doc.created_at)}</span>
            {processing && <Badge variant="secondary" className="gap-1"><Clock className="size-3" /> Getting ready</Badge>}
            {failed && <Badge variant="destructive">Needs attention</Badge>}
            <ExpiryChip date={doc.expiry_date} />
          </span>
        </span>
        <PeopleAvatars people={doc.people} />
        <FavouriteButton on={!!doc.is_favorite} onToggle={onToggleFavourite ? () => onToggleFavourite(doc) : null} />
      </Link>
    )
  }

  return (
    <Link to={href} className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lift">
      <div className="relative">
        <SignedImage workspaceId={workspaceId} fileId={thumb?.id} alt="" className="aspect-[4/3] w-full bg-muted" fallback={<Placeholder type={doc.document_type} />} />
        <FavouriteButton on={!!doc.is_favorite} onToggle={onToggleFavourite ? () => onToggleFavourite(doc) : null} className="absolute top-1 right-1 bg-card/80 backdrop-blur-sm" />
        {processing && (
          <Badge variant="secondary" className="absolute bottom-2 left-2 gap-1 bg-card/90"><Clock className="size-3" /> Getting ready</Badge>
        )}
        {failed && <Badge variant="destructive" className="absolute bottom-2 left-2">Needs attention</Badge>}
        {doc.page_count > 1 && !processing && !failed && (
          <Badge variant="secondary" className="absolute bottom-2 left-2 bg-card/90">{doc.page_count} pages</Badge>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <span className="line-clamp-2 leading-snug font-medium">{doc.name}</span>
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="truncate">{documentTypeLabel(doc.document_type)}</Badge>
          <PeopleAvatars people={doc.people} />
        </div>
        <ExpiryChip date={doc.expiry_date} className="self-start" />
      </div>
    </Link>
  )
}

export function DocumentCardSkeleton({ view = 'grid' }) {
  if (view === 'list') return <Skeleton className="h-20 rounded-2xl" />
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  )
}
