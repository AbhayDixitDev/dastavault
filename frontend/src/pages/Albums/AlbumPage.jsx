import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ImageIcon, MoreHorizontal, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetAlbumQuery, useLazyGetAlbumQuery, useUpdateAlbumMutation, useDeleteAlbumMutation, useAddAlbumItemsMutation, useRemoveAlbumItemMutation } from '@/store/api/albumsApi'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { api } from '@/services/api/client'
import { useDocumentTypes } from '@/services/search/documentTypes'
import { AlbumDialog } from '@/components/albums/AlbumDialog'
import { AlbumKindBadge } from '@/components/albums/AlbumCard'
import { describeRules } from '@/components/albums/SmartRuleBuilder'
import { DocumentPicker } from '@/components/search/DocumentPicker'
import { CompactDocumentCard, useDocumentCard } from '@/components/search/ResultCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'

async function findCoverFileId(workspaceId, doc) {
  if (doc.thumbnail_file_id) return doc.thumbnail_file_id
  try {
    const res = await api.get(`/workspaces/${workspaceId}/documents/${doc.id}`)
    const files = res?.document?.files ?? []
    const thumb = files.find((f) => f.kind === 'thumbnail') ?? files.find((f) => (f.mime_type || '').startsWith('image/')) ?? files[0]
    return thumb?.id ?? null
  } catch {
    return null
  }
}

export function AlbumPage() {
  const { id: albumId } = useParams()
  const navigate = useNavigate()
  const { workspaceId, can, terminology } = useWorkspace()
  const canEdit = can('editor')
  const { data, isLoading, error, refetch } = useGetAlbumQuery({ workspaceId, albumId }, { skip: !workspaceId || !albumId })
  const [loadMore, { isFetching: loadingMore }] = useLazyGetAlbumQuery()
  const [extra, setExtra] = useState([])
  const [cursor, setCursor] = useState(null)
  const [updateAlbum] = useUpdateAlbumMutation()
  const [deleteAlbum, { isLoading: deleting }] = useDeleteAlbumMutation()
  const [addItems] = useAddAlbumItemsMutation()
  const [removeItem] = useRemoveAlbumItemMutation()
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId })
  const types = useDocumentTypes()
  const DocumentCard = useDocumentCard()

  const [editOpen, setEditOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setExtra([])
    setCursor(data?.next_cursor ?? null)
  }, [data])

  const album = data?.album
  const documents = useMemo(() => [...(data?.documents ?? []), ...extra], [data, extra])
  const isSmart = album?.kind === 'smart'
  const isManual = album?.kind === 'manual'

  const more = async () => {
    if (!cursor) return
    const page = await loadMore({ workspaceId, albumId, cursor }).unwrap()
    setExtra((prev) => [...prev, ...page.documents])
    setCursor(page.next_cursor)
  }

  const onAdd = async (docs) => {
    if (!docs.length) return
    try {
      const added = await addItems({ workspaceId, albumId, document_ids: docs.map((d) => d.id) }).unwrap()
      toast.success(`${added || docs.length} added to "${album?.name}".`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onRemove = async (doc) => {
    try {
      await removeItem({ workspaceId, albumId, documentId: doc.id }).unwrap()
      toast.success(`Removed "${doc.name}".`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onSetCover = async (doc) => {
    const fileId = await findCoverFileId(workspaceId, doc)
    if (!fileId) {
      toast.error('This document has no picture to use as a cover yet.')
      return
    }
    try {
      await updateAlbum({ workspaceId, albumId, cover_file_id: fileId }).unwrap()
      toast.success('Cover updated.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onDelete = async () => {
    try {
      await deleteAlbum({ workspaceId, albumId }).unwrap()
      toast.success('Album deleted. Your documents are safe.')
      navigate(`/w/${workspaceId}/albums`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl">
        <ErrorBox error={error} onRetry={refetch} />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-start gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to albums">
          <Link to={`/w/${workspaceId}/albums`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          {isLoading || !album ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{album.name}</h1>
                <AlbumKindBadge kind={album.kind} />
              </div>
              <p className="text-sm text-muted-foreground">
                {album.item_count ?? documents.length} document{(album.item_count ?? documents.length) === 1 ? '' : 's'}
                {album.description ? ` - ${album.description}` : ''}
              </p>
              {isSmart && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  <Wand2 className="size-3" /> {describeRules(album.rules, { people, groups, types })}
                </p>
              )}
            </>
          )}
        </div>
        {canEdit && album && (
          <div className="flex shrink-0 items-center gap-2">
            {isManual && (
              <Button onClick={() => setPickerOpen(true)}>
                <Plus /> Add documents
              </Button>
            )}
            {isSmart && (
              <Button variant="outline" onClick={() => setRulesOpen(true)}>
                <Wand2 /> Edit rules
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil /> Rename or describe
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 /> Delete album
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={isSmart ? 'No documents match these rules yet' : 'This album is empty'}
          description={isSmart ? 'Change the rules, or add documents that match them.' : 'Add documents to see them here.'}
          action={
            canEdit &&
            (isManual ? (
              <Button onClick={() => setPickerOpen(true)}>
                <Plus /> Add documents
              </Button>
            ) : isSmart ? (
              <Button variant="outline" onClick={() => setRulesOpen(true)}>
                <Wand2 /> Edit rules
              </Button>
            ) : null)
          }
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((doc) => (
              <li key={doc.id} className="group relative">
                {DocumentCard ? <DocumentCard document={doc} workspaceId={workspaceId} /> : <CompactDocumentCard document={doc} workspaceId={workspaceId} types={types} />}
                {canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" size="icon-sm" aria-label={`Options for ${doc.name}`} className="absolute right-2 top-2 shadow-soft opacity-80 group-hover:opacity-100 focus-visible:opacity-100">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onSetCover(doc)}>
                        <ImageIcon /> Use as cover
                      </DropdownMenuItem>
                      {isManual && (
                        <DropdownMenuItem variant="destructive" onClick={() => onRemove(doc)}>
                          <X /> Remove from album
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Show more'}
              </Button>
            </div>
          )}
        </>
      )}

      <AlbumDialog open={editOpen} onOpenChange={setEditOpen} album={album} />
      <AlbumDialog open={rulesOpen} onOpenChange={setRulesOpen} album={album} rulesOnly />
      <DocumentPicker open={pickerOpen} onOpenChange={setPickerOpen} workspaceId={workspaceId} multiple excludeIds={documents.map((d) => d.id)} onPick={onAdd} title={`Add to "${album?.name ?? 'album'}"`} description={`Search by name, ${(terminology?.person_label ?? 'person').toLowerCase()} or type. Pick as many as you like.`} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this album?</AlertDialogTitle>
            <AlertDialogDescription>Only the album goes away. The documents inside stay where they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleting} className="bg-destructive text-white hover:bg-destructive/90">
              Delete album
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
