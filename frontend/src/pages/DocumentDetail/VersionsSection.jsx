import { useState } from 'react'
import { toast } from 'sonner'
import { GitCompare, RotateCcw, Upload, Paperclip, Check } from 'lucide-react'
import { useGetVersionsQuery, useRestoreVersionMutation } from '@/store/api/documentsApi'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'
import { formatBytes } from '@/services/files'
import { formatDate, fromNow } from '@/utils/format'
import { CompareVersionsDialog } from './CompareVersionsDialog'

const TEXT_STATUS = {
  done: 'Text read',
  failed: 'Could not read text',
  skipped: 'No text',
  pending: 'Reading text...',
}

/**
 * List of versions with restore, compare and "upload new version".
 * `onNewVersion` opens the upload dialog owned by the page.
 */
export function VersionsSection({ workspaceId, document: doc, canEdit, onNewVersion, onView, viewingVersionId }) {
  const { data: versions = [], isLoading, error, refetch } = useGetVersionsQuery({ workspaceId, documentId: doc.id })
  const [restoreVersion, { isLoading: restoring }] = useRestoreVersionMutation()
  const [toRestore, setToRestore] = useState(null)
  const [compareOpen, setCompareOpen] = useState(false)

  const onRestore = async () => {
    if (!toRestore) return
    try {
      await restoreVersion({ workspaceId, documentId: doc.id, versionId: toRestore.id }).unwrap()
      toast.success(`Version ${toRestore.version_number} is now the current one.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setToRestore(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Every upload is kept. You can go back to any of them.</p>
        <div className="flex gap-2">
          {versions.length > 1 && <Button size="sm" variant="outline" onClick={() => setCompareOpen(true)}><GitCompare /> Compare</Button>}
          {canEdit && <Button size="sm" onClick={onNewVersion}><Upload /> Upload new version</Button>}
        </div>
      </div>

      {error && <ErrorBox error={error} onRetry={refetch} />}
      {isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {versions.map((v) => {
            const current = v.id === doc.current_version_id
            const viewing = (viewingVersionId ?? doc.current_version_id) === v.id
            return (
              <li key={v.id} className={`rounded-xl border p-3 ${current ? 'border-primary/40 bg-primary/5' : 'bg-card'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Version {v.version_number}</span>
                  {current && <Badge>Current</Badge>}
                  {v.ocr_status && v.ocr_status !== 'done' && <Badge variant="secondary">{TEXT_STATUS[v.ocr_status] || v.ocr_status}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{fromNow(v.created_at)} · {formatDate(v.created_at, 'D MMM YYYY, h:mm A')}</span>
                </div>
                {v.comment && <p className="mt-1 text-sm">{v.comment}</p>}
                {v.created_by_name && <p className="mt-0.5 text-xs text-muted-foreground">By {v.created_by_name}</p>}
                {(v.files ?? []).length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {v.files.filter((f) => f.kind !== 'thumbnail').map((f) => (
                      <li key={f.id} className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        <Paperclip className="size-3" /> {f.original_filename || f.kind}{f.page_number ? ` (p.${f.page_number})` : ''} · {formatBytes(f.size_bytes)}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {onView && !viewing && <Button size="sm" variant="ghost" onClick={() => onView(v.id)}>View</Button>}
                  {onView && viewing && !current && <Button size="sm" variant="ghost" onClick={() => onView(null)}><Check /> Viewing · back to current</Button>}
                  {canEdit && !current && (
                    <Button size="sm" variant="outline" disabled={restoring} onClick={() => setToRestore(v)}><RotateCcw /> Restore</Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog open={!!toRestore} onOpenChange={(o) => !o && setToRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {toRestore?.version_number}?</AlertDialogTitle>
            <AlertDialogDescription>A copy of this version becomes the current one. Nothing is deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onRestore}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CompareVersionsDialog open={compareOpen} onOpenChange={setCompareOpen} versions={versions} />
    </div>
  )
}
