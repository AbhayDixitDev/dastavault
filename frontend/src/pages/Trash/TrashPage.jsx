import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, RotateCcw, Trash2, Info } from 'lucide-react'
import { useWorkspace } from '@/hooks/useWorkspace'
import { useGetTrashQuery, useRestoreDocumentMutation, usePurgeDocumentMutation } from '@/store/api/documentsApi'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { documentTypeLabel } from '@/components/documents/documentTypes'
import { formatDate, fromNow } from '@/utils/format'

export function TrashPage() {
  const { workspaceId, can } = useWorkspace()
  const { data, isLoading, error, refetch } = useGetTrashQuery({ workspaceId }, { skip: !workspaceId })
  const [restoreDocument, { isLoading: restoring }] = useRestoreDocumentMutation()
  const [purgeDocument, { isLoading: purging }] = usePurgeDocumentMutation()
  const [toPurge, setToPurge] = useState(null)
  const documents = data?.documents ?? []
  const isAdmin = can('admin')

  const onRestore = async (doc) => {
    try {
      await restoreDocument({ workspaceId, documentId: doc.id }).unwrap()
      toast.success(`“${doc.name}” is back in your documents.`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const onPurge = async () => {
    if (!toPurge) return
    try {
      await purgeDocument({ workspaceId, documentId: toPurge.id }).unwrap()
      toast.success('Removed for good.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setToPurge(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link to=".." relative="path" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Documents
      </Link>
      <PageHeader title="Trash" description="Documents you removed. You can bring them back." />

      <div className="mb-4 flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>Items are removed for good after 30 days.</span>
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} className="mb-4" />}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : documents.length === 0 ? (
        <EmptyState icon={Trash2} title="The trash is empty" description="Documents you remove will wait here for 30 days." />
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
              <DocumentTypeIcon type={doc.document_type} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{doc.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {documentTypeLabel(doc.document_type)} · removed {fromNow(doc.deleted_at)} · added {formatDate(doc.created_at)}
                </span>
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={restoring} onClick={() => onRestore(doc)}><RotateCcw /> Restore</Button>
                {isAdmin && (
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={purging} onClick={() => setToPurge(doc)}>
                    <Trash2 /> Remove for good
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!toPurge} onOpenChange={(v) => !v && setToPurge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{toPurge?.name}” for good?</AlertDialogTitle>
            <AlertDialogDescription>All its files and versions will be deleted. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onPurge} className="bg-destructive text-white hover:bg-destructive/90">Remove for good</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
