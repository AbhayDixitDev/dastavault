import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Images, Wand2, User, FileText, FolderTree, CalendarDays } from 'lucide-react'
import { DocumentThumb } from '@/components/search/DocumentThumb'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export const ALBUM_KINDS = {
  manual: { label: 'Manual', icon: Images },
  smart: { label: 'Smart', icon: Wand2 },
  person: { label: 'Person', icon: User },
  type: { label: 'Type', icon: FileText },
  group: { label: 'Group', icon: FolderTree },
  event: { label: 'Event', icon: CalendarDays },
}

export function AlbumKindBadge({ kind, className }) {
  const k = ALBUM_KINDS[kind] ?? ALBUM_KINDS.manual
  return (
    <Badge variant={kind === 'smart' ? 'default' : 'secondary'} className={cn('gap-1', className)}>
      <k.icon className="size-3" /> {k.label}
    </Badge>
  )
}

/** Album tile with a lazily loaded cover and a subtle hover lift. */
export function AlbumCard({ album, workspaceId, className }) {
  const count = album.item_count ?? 0
  return (
    <motion.div whileHover={{ y: -2, scale: 1.01 }} whileTap={{ scale: 0.99 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className={className}>
      <Link to={`/w/${workspaceId}/albums/${album.id}`} className="block overflow-hidden rounded-2xl border bg-card outline-none transition-shadow hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring/50">
        <div className="relative aspect-[4/3] w-full">
          <DocumentThumb workspaceId={workspaceId} fileId={album.cover_file_id} className="size-full rounded-none" iconClassName="size-8" alt="" />
          <AlbumKindBadge kind={album.kind} className="absolute left-2 top-2 shadow-soft" />
        </div>
        <div className="p-3">
          <p className="truncate font-medium">{album.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {count} document{count === 1 ? '' : 's'}
            {album.description ? ` - ${album.description}` : ''}
          </p>
        </div>
      </Link>
    </motion.div>
  )
}
