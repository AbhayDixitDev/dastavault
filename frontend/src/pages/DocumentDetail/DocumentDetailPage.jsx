import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Share2, Pencil, Upload, MoreHorizontal, Trash2, Download, MessageSquare, GitCompare } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { useGetDocumentQuery, useDeleteDocumentMutation, useRestoreDocumentMutation, useGetVersionsQuery } from '@/store/api/documentsApi'
import { useGetPeopleQuery } from '@/store/api/peopleApi'
import { useGetGroupsQuery } from '@/store/api/groupsApi'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { DocumentViewer, describeVersionFiles } from '@/components/viewer/DocumentViewer'
import { getSignedUrl } from '@/services/files/signedUrls'
import { DetailsPanel } from './DetailsPanel'
import { VersionsSection } from './VersionsSection'
import { TimelineSection } from './TimelineSection'
import { RelatedDocuments } from './RelatedDocuments'
import { ShareDialog } from './ShareDialog'
import { NewVersionDialog } from './NewVersionDialog'
import { CompareVersionsDialog } from './CompareVersionsDialog'

function AskSection({ workspaceId, doc }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border bg-muted/30 p-4">
      <p className="text-sm">Ask a question and get an answer from the text inside this document.</p>
      <Button asChild variant="outline">
        <Link to={`/w/${workspaceId}/search?ask=1&document_id=${doc.id}`}><MessageSquare /> Ask about this document</Link>
      </Button>
    </div>
  )
}

export function DocumentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const { workspaceId, can } = useWorkspace()
  const { data: doc, isLoading, error, refetch } = useGetDocumentQuery({ workspaceId, documentId: id }, { skip: !workspaceId || !id })
  const { data: versions = [] } = useGetVersionsQuery({ workspaceId, documentId: id }, { skip: !workspaceId || !id })
  const { data: people = [] } = useGetPeopleQuery(workspaceId, { skip: !workspaceId })
  const { data: groups = [] } = useGetGroupsQuery(workspaceId, { skip: !workspaceId })
  const [deleteDocument, { isLoading: deleting }] = useDeleteDocumentMutation()
  const [restoreDocument] = useRestoreDocumentMutation()

  const [shareOpen, setShareOpen] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [viewVersionId, setViewVersionId] = useState(null)
  const [tab, setTab] = useState(isDesktop ? 'versions' : 'details')

  const canEdit = can('editor')

  // Keep polling while the server is still getting the document ready.
  useEffect(() => {
    if (doc?.status !== 'processing') return undefined
    const t = setTimeout(() => refetch(), 6000)
    return () => clearTimeout(t)
  }, [doc?.status, doc?.updated_at, refetch])

  useEffect(() => {
    setTab(isDesktop ? (tab === 'details' ? 'versions' : tab) : tab)
  }, [isDesktop]) // eslint-disable-line react-hooks/exhaustive-deps

  const onDelete = async () => {
    setConfirmDelete(false)
    try {
      await deleteDocument({ workspaceId, documentId: id }).unwrap()
      navigate(`/w/${workspaceId}/documents`, { replace: true })
      toast('Moved to trash.', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await restoreDocument({ workspaceId, documentId: id }).unwrap()
              toast.success('Document restored.')
            } catch (err) {
              toast.error(errorMessage(err))
            }
          },
        },
        duration: 8000,
      })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const download = async () => {
    const info = describeVersionFiles(doc?.files, viewVersionId ?? doc?.current_version_id)
    if (!info.download) return
    const url = await getSignedUrl(workspaceId, info.download.id, { download: true })
    if (url) window.open(url, '_blank', 'noopener')
    else toast.error('Could not get the file right now.')
  }

  if (isLoading) {
    return (
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_380px]">
        <Skeleton className="min-h-[60svh] rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }
  if (error) return <div className="mx-auto max-w-xl"><ErrorBox error={error} onRetry={refetch} title="Could not open this document" /></div>
  if (!doc) return null

  const viewingOld = viewVersionId && viewVersionId !== doc.current_version_id
  const viewingVersion = viewingOld ? versions.find((v) => v.id === viewVersionId) : null
  // Files for an older version come from the versions list; the document itself carries the current ones.
  const docForViewer = viewingVersion?.files?.length ? { ...doc, files: viewingVersion.files } : doc

  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={isDesktop ? 'icon' : 'lg'} aria-label="More" className={isDesktop ? '' : 'flex-1'}>
          <MoreHorizontal /> {!isDesktop && 'More'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={download}><Download /> Download</DropdownMenuItem>
        {versions.length > 1 && <DropdownMenuItem onClick={() => setCompareOpen(true)}><GitCompare /> Compare versions</DropdownMenuItem>}
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2 /> Move to trash</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const sections = (
    <Tabs value={tab} onValueChange={setTab} className="gap-3">
      <TabsList className="w-full overflow-x-auto sm:w-fit">
        {!isDesktop && <TabsTrigger value="details">Details</TabsTrigger>}
        <TabsTrigger value="versions">Versions{versions.length > 1 ? ` (${versions.length})` : ''}</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="related">Related</TabsTrigger>
        <TabsTrigger value="ask">Ask</TabsTrigger>
      </TabsList>
      {!isDesktop && (
        <TabsContent value="details" className="rounded-2xl border bg-card p-4">
          <DetailsPanel workspaceId={workspaceId} document={doc} canEdit={canEdit} />
        </TabsContent>
      )}
      <TabsContent value="versions" className="rounded-2xl border bg-card p-4">
        <VersionsSection workspaceId={workspaceId} document={doc} canEdit={canEdit} onNewVersion={() => setVersionOpen(true)} onView={setViewVersionId} viewingVersionId={viewVersionId} />
      </TabsContent>
      <TabsContent value="timeline" className="rounded-2xl border bg-card p-4">
        <TimelineSection workspaceId={workspaceId} documentId={doc.id} />
      </TabsContent>
      <TabsContent value="related" className="rounded-2xl border bg-card p-4">
        <RelatedDocuments workspaceId={workspaceId} document={doc} />
      </TabsContent>
      <TabsContent value="ask">
        <AskSection workspaceId={workspaceId} doc={doc} />
      </TabsContent>
    </Tabs>
  )

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link to={`/w/${workspaceId}/documents`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Documents
        </Link>
        {isDesktop && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShareOpen(true)}><Share2 /> Share</Button>
            {canEdit && <Button variant="outline" onClick={() => setVersionOpen(true)}><Upload /> New version</Button>}
            {moreMenu}
          </div>
        )}
      </div>

      {!isDesktop && <h1 className="mb-3 text-xl leading-tight font-bold break-words">{doc.name}</h1>}

      {viewingOld && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span>You are looking at version {viewingVersion?.version_number}. The current one is newer.</span>
          <Button size="sm" variant="outline" onClick={() => setViewVersionId(null)}>Back to current</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <DocumentViewer workspaceId={workspaceId} document={docForViewer} versionId={viewVersionId ?? doc.current_version_id} />
          {isDesktop && sections}
        </div>

        {isDesktop && (
          <aside className="scroll-inside sticky top-4 max-h-[calc(100svh-6rem)] rounded-2xl border bg-card p-4 shadow-soft">
            <DetailsPanel workspaceId={workspaceId} document={doc} canEdit={canEdit} />
          </aside>
        )}

        {!isDesktop && (
          <>
            <div className="flex gap-2">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => setShareOpen(true)}><Share2 /> Share</Button>
              {canEdit && <Button variant="outline" size="lg" className="flex-1" onClick={() => setTab('details')}><Pencil /> Edit</Button>}
              {canEdit && <Button variant="outline" size="lg" className="flex-1" onClick={() => setVersionOpen(true)}><Upload /> Version</Button>}
              {moreMenu}
            </div>
            {sections}
          </>
        )}
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} workspaceId={workspaceId} document={doc} canEdit={canEdit} />
      <NewVersionDialog open={versionOpen} onOpenChange={setVersionOpen} workspaceId={workspaceId} document={doc} people={people} groups={groups} onDone={() => setViewVersionId(null)} />
      <CompareVersionsDialog open={compareOpen} onOpenChange={setCompareOpen} versions={versions} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{doc.name}” to the trash?</AlertDialogTitle>
            <AlertDialogDescription>You can bring it back from the trash within 30 days.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleting}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
