import { useState } from 'react'
import { FileText, ImageIcon, StickyNote } from 'lucide-react'
import { useGetFileUrlQuery } from '@/store/api/searchApi'
import { cn } from '@/lib/utils'

/**
 * Lazily loads a signed URL for a thumbnail file and shows it, with a calm
 * icon fallback while loading or when there is no thumbnail.
 */
export function DocumentThumb({ workspaceId, fileId, alt = '', kind, className, iconClassName }) {
  const [broken, setBroken] = useState(false)
  const { data: url } = useGetFileUrlQuery({ workspaceId, fileId }, { skip: !workspaceId || !fileId })
  const Icon = kind === 'note' ? StickyNote : kind === 'image' ? ImageIcon : FileText

  return (
    <div className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground', className)}>
      {url && !broken ? (
        <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Icon className={cn('size-6', iconClassName)} aria-hidden="true" />
      )}
    </div>
  )
}
