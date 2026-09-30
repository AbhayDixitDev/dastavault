import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/components/common/ErrorBox'
import { UploadDropzone } from '@/components/documents/UploadDropzone'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { api } from '@/services/api/client'
import { sha256Hex, compressImage, makeThumbnail, fileKind, formatBytes } from '@/services/files'
import { pdfThumbnail } from '@/services/pdf'
import { documentsApi } from '@/store/api/documentsApi'
import { useDispatch } from 'react-redux'

/**
 * Upload a new version of a document (files + comment). After the server
 * responds we add a preview and start reading the text in the background.
 */
export function NewVersionDialog({ open, onOpenChange, workspaceId, document: doc, people = [], groups = [], onDone }) {
  const dispatch = useDispatch()
  const [files, setFiles] = useState([])
  const [comment, setComment] = useState('')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setFiles([])
      setComment('')
      setProgress(0)
      setStatus('')
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    if (!files.length || busy) return
    setBusy(true)
    try {
      setStatus('Preparing files...')
      const prepared = []
      for (const f of files) {
        const file = await compressImage(f)
        prepared.push({ file, sha: await sha256Hex(file) })
      }
      const fd = new FormData()
      prepared.forEach((p, i) => {
        fd.append('files[]', p.file, p.file.name)
        fd.append('sha256[]', p.sha)
        fd.append('page_numbers[]', String(i + 1))
      })
      if (comment.trim()) fd.append('comment', comment.trim())
      setStatus('Uploading')
      const res = await api.post(`/workspaces/${workspaceId}/documents/${doc.id}/versions`, fd, { onUploadProgress: (p) => setProgress(Math.round(p * 100)) })
      setStatus('Uploaded')
      const version = res?.version
      const uploaded = res?.files ?? []

      // Preview from the first file.
      const first = prepared[0]?.file
      if (version && first) {
        let thumb = null
        const kind = fileKind(first)
        if (kind === 'image') thumb = await makeThumbnail(first)
        else if (kind === 'pdf') thumb = await pdfThumbnail(first)
        if (thumb) {
          const tfd = new FormData()
          tfd.append('files[]', thumb, 'thumbnail.webp')
          tfd.append('kind', 'thumbnail')
          await api.post(`/workspaces/${workspaceId}/documents/${doc.id}/versions/${version.id}/files`, tfd).catch(() => null)
        }
      }

      dispatch(documentsApi.util.invalidateTags([{ type: 'Document', id: doc.id }, { type: 'Versions', id: doc.id }, 'Documents']))
      toast.success('New version saved.')
      onOpenChange(false)
      onDone?.(res)

      // Read text in the background; never block the UI on this.
      if (version) {
        const mod = await import('@/services/pipeline/processDocument.js').catch(() => null)
        if (mod?.processDocument) {
          const blobs = uploaded.map((uf, i) => ({ id: uf.id, kind: uf.kind, mime_type: uf.mime_type, page_number: uf.page_number ?? i + 1, blob: prepared[i]?.file }))
          mod.processDocument({ workspaceId, documentId: doc.id, versionId: version.id, files: blobs, people, groups, onStatus: () => {} })
            .then(() => dispatch(documentsApi.util.invalidateTags([{ type: 'Document', id: doc.id }, { type: 'Versions', id: doc.id }, { type: 'Suggestions', id: doc.id }])))
            .catch(() => {})
        }
      }
    } catch (err) {
      toast.error(errorMessage(err))
      setStatus('')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a new version</DialogTitle>
          <DialogDescription>The old version stays saved. You can go back to it any time.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {files.length === 0 ? (
            <UploadDropzone compact onFiles={(list) => setFiles(list.slice(0, 20))} disabled={busy} />
          ) : (
            <ul className="flex flex-col gap-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-xl border p-2">
                  <DocumentTypeIcon type={fileKind(f) === 'image' ? 'photo' : 'other'} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{f.name}</span>
                    <span className="block text-xs text-muted-foreground">{formatBytes(f.size)}</span>
                  </span>
                  {!busy && (
                    <button type="button" aria-label="Remove" className="tap-target flex items-center justify-center text-muted-foreground hover:text-destructive" onClick={() => setFiles((arr) => arr.filter((_, j) => j !== i))}>
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              ))}
              {!busy && <UploadDropzone compact onFiles={(list) => setFiles((arr) => [...arr, ...list].slice(0, 20))} className="p-3" />}
            </ul>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="nv-comment">What changed? (optional)</Label>
            <Textarea id="nv-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="For example: renewed for 2027" disabled={busy} />
          </div>
          {busy && (
            <div className="grid gap-1.5">
              <Progress value={status === 'Uploading' ? progress : status === 'Uploaded' ? 100 : 5} />
              <p className="text-xs text-muted-foreground">{status}{status === 'Uploading' ? ` ${progress}%` : ''}</p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || files.length === 0}>{busy ? <Spinner size="sm" /> : null} Save new version</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
