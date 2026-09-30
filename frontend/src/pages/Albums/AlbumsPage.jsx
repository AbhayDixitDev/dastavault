import { useMemo, useState } from 'react'
import { Images, Plus } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetAlbumsQuery } from '@/store/api/albumsApi'
import { AlbumCard, ALBUM_KINDS } from '@/components/albums/AlbumCard'
import { AlbumDialog } from '@/components/albums/AlbumDialog'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBox } from '@/components/common/ErrorBox'
import { cn } from '@/lib/utils'

export function AlbumsPage() {
  const { workspaceId, can } = useWorkspace()
  const { data: albums = [], isLoading, error, refetch } = useGetAlbumsQuery(workspaceId, { skip: !workspaceId })
  const [open, setOpen] = useState(false)
  const [kindFilter, setKindFilter] = useState('all')
  const canEdit = can('editor')

  const kindsPresent = useMemo(() => [...new Set(albums.map((a) => a.kind))].filter((k) => ALBUM_KINDS[k]), [albums])
  const shown = kindFilter === 'all' ? albums : albums.filter((a) => a.kind === kindFilter)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Albums"
        description="Group documents the way you think about them. Smart albums fill themselves."
        actions={
          canEdit && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New album
            </Button>
          )
        }
      />

      {kindsPresent.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {['all', ...kindsPresent].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              aria-pressed={kindFilter === k}
              className={cn('h-8 rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50', kindFilter === k ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card hover:bg-accent')}
            >
              {k === 'all' ? 'All' : ALBUM_KINDS[k].label}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Images}
          title={albums.length === 0 ? 'No albums yet' : 'No albums of this kind'}
          description={albums.length === 0 ? 'Make an album for a trip, a person, or let a smart album collect documents by rules.' : 'Try another kind.'}
          action={
            albums.length === 0 &&
            canEdit && (
              <Button onClick={() => setOpen(true)}>
                <Plus /> New album
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((a) => (
            <AlbumCard key={a.id} album={a} workspaceId={workspaceId} />
          ))}
        </div>
      )}

      <AlbumDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
