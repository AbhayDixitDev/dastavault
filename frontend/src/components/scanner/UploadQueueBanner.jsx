import { Link } from 'react-router-dom'
import { AlertCircle, CheckCircle2, CloudUpload, HardDrive, RefreshCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { UPLOAD_STATUS, UPLOAD_STATUS_LABEL } from '@/services/offline/db'
import { useUploadQueue } from '@/services/offline/uploadQueue'

const ICONS = {
  [UPLOAD_STATUS.SAVED_ON_DEVICE]: HardDrive,
  [UPLOAD_STATUS.UPLOADING]: CloudUpload,
  [UPLOAD_STATUS.UPLOADED]: CheckCircle2,
  [UPLOAD_STATUS.FAILED]: AlertCircle,
}

/**
 * Shows queued uploads with their status. Renders nothing when the queue is empty.
 * Mount once in the app shell; pass `workspaceId` to show only that workspace's items.
 */
export function UploadQueueBanner({ workspaceId, className }) {
  const { items, retry, remove } = useUploadQueue()
  const list = workspaceId ? items.filter((i) => i.workspaceId === workspaceId) : items
  if (!list.length) return null

  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite">
      {list.map((item) => {
        const Icon = ICONS[item.status] || CloudUpload
        const failed = item.status === UPLOAD_STATUS.FAILED
        const uploaded = item.status === UPLOAD_STATUS.UPLOADED
        const label = UPLOAD_STATUS_LABEL[item.status] || item.status
        const detail = item.processing ? item.statusText : failed ? item.error : item.statusText
        return (
          <div key={item.id} className={cn('flex items-start gap-3 rounded-xl border bg-card px-3 py-2 text-sm shadow-soft', failed && 'border-destructive/40')}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', failed ? 'text-destructive' : uploaded ? 'text-brand-teal' : 'text-primary', item.status === UPLOAD_STATUS.UPLOADING && 'animate-pulse')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{item.name || 'Scan'}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
              </div>
              {detail && detail !== label && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
              {item.status === UPLOAD_STATUS.UPLOADING && <Progress value={Math.round((item.progress || 0) * 100)} className="mt-1.5 h-1.5" />}
              {uploaded && item.documentId && item.workspaceId && (
                <Link to={`/w/${item.workspaceId}/documents/${item.documentId}`} className="text-xs text-primary underline-offset-2 hover:underline">Open document</Link>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {failed && (
                <Button variant="ghost" size="icon-sm" onClick={() => retry(item.id)} aria-label="Try again"><RefreshCcw /></Button>
              )}
              {(failed || uploaded || item.status === UPLOAD_STATUS.SAVED_ON_DEVICE) && !item.processing && (
                <Button variant="ghost" size="icon-sm" onClick={() => remove(item.id)} aria-label="Remove"><X /></Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
