import { useEffect, useMemo, useState } from 'react'
import { Download, Maximize, Minimize, FileText, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useGetDocumentContentQuery } from '@/store/api/documentsApi'
import { getSignedUrl, fetchFileBlob, useSignedUrl } from '@/services/files/signedUrls'
import { fileKind, formatBytes } from '@/services/files'
import { DocumentTypeIcon } from '@/components/documents/DocumentTypeIcon'
import { SignedImage } from '@/components/documents/SignedImage'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { TextViewer } from './TextViewer'
import { cn } from '@/lib/utils'

/** Works out what to show for a version: page images, a pdf, text, or a plain file. */
export function describeVersionFiles(files = [], versionId) {
  const own = versionId ? files.filter((f) => f.version_id === versionId) : files
  const list = own.length ? own : files
  const byPage = (arr) => [...arr].sort((a, b) => (a.page_number ?? 1) - (b.page_number ?? 1))
  const images = (kind) => byPage(list.filter((f) => f.kind === kind && (f.mime_type || '').startsWith('image/')))
  const processed = images('processed')
  const originals = images('original')
  const pages = processed.length ? processed : originals
  const pdf = list.find((f) => f.kind === 'pdf') || list.find((f) => f.kind === 'original' && (f.mime_type || '') === 'application/pdf')
  const textFile = list.find((f) => f.kind === 'original' && /^text\/(html|plain|markdown|csv)/.test(f.mime_type || ''))
  const original = list.find((f) => f.kind === 'original') || list[0] || null
  if (pages.length) return { mode: 'images', pages, original, download: original || pages[0] }
  if (pdf) return { mode: 'pdf', pdf, original, download: original || pdf }
  if (textFile) return { mode: 'text', textFile, original, download: textFile }
  if (original) return { mode: 'file', original, download: original }
  return { mode: 'empty', original: null, download: null }
}

function PageStrip({ workspaceId, pages, current, onSelect }) {
  if (pages.length < 2) return null
  return (
    <div className="flex gap-2 overflow-x-auto border-t bg-card/80 p-2">
      {pages.map((f, i) => (
        <button
          key={f.id}
          type="button"
          aria-label={`Page ${i + 1}`}
          aria-current={i === current}
          onClick={() => onSelect(i)}
          className={cn('relative h-16 w-12 shrink-0 overflow-hidden rounded-md border-2 bg-muted', i === current ? 'border-primary' : 'border-transparent hover:border-border')}
        >
          <SignedImage workspaceId={workspaceId} fileId={f.id} className="size-full" />
          <span className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
        </button>
      ))}
    </div>
  )
}

function ImagesMode({ workspaceId, pages }) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [pages])
  const file = pages[Math.min(index, pages.length - 1)]
  const { url, loading } = useSignedUrl(workspaceId, file?.id)
  return (
    <div className="flex size-full flex-col">
      <div className="relative min-h-0 flex-1">
        {loading && !url && <div className="absolute inset-0 flex items-center justify-center"><Spinner label="Opening" /></div>}
        {url && <ImageViewer src={url} alt={`Page ${index + 1}`} />}
        {!loading && !url && <p className="flex size-full items-center justify-center text-sm text-muted-foreground">Could not open this page.</p>}
      </div>
      <PageStrip workspaceId={workspaceId} pages={pages} current={index} onSelect={setIndex} />
    </div>
  )
}

function PdfMode({ workspaceId, file }) {
  const [blob, setBlob] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setBlob(null)
    setFailed(false)
    fetchFileBlob(workspaceId, file.id).then((b) => {
      if (!alive) return
      if (b) setBlob(b)
      else setFailed(true)
    })
    return () => { alive = false }
  }, [workspaceId, file.id])
  if (failed) return <p className="flex size-full items-center justify-center text-sm text-muted-foreground">Could not open this PDF.</p>
  if (!blob) return <div className="flex size-full items-center justify-center"><Spinner label="Opening" /></div>
  return <PdfViewer blob={blob} />
}

function TextMode({ workspaceId, documentId, file }) {
  const { data, isLoading, isError } = useGetDocumentContentQuery({ workspaceId, documentId })
  const [raw, setRaw] = useState(null)
  // Fall back to the stored file when the content route has nothing for us.
  useEffect(() => {
    let alive = true
    if (!isError || !file) return undefined
    fetchFileBlob(workspaceId, file.id).then(async (b) => {
      if (!alive || !b) return
      const text = await b.text().catch(() => '')
      setRaw({ html: /html/.test(file.mime_type || '') ? text : '', text: /html/.test(file.mime_type || '') ? '' : text })
    })
    return () => { alive = false }
  }, [isError, file, workspaceId])
  if (isLoading) return <div className="flex size-full items-center justify-center"><Spinner label="Opening" /></div>
  const html = data?.content_html ?? raw?.html
  const text = data?.content_text ?? raw?.text
  return <TextViewer html={html} text={text} />
}

function FileMode({ workspaceId, file, document: doc }) {
  const kind = fileKind(file)
  const label = kind === 'docx' ? 'This is an Office file. Download it to open it on your device.' : 'This file type cannot be shown here. Download it to open it on your device.'
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
      <DocumentTypeIcon type={doc?.document_type} size="xl" />
      <p className="font-medium">{file.original_filename || doc?.name}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{formatBytes(file.size_bytes)}</p>
      <DownloadButton workspaceId={workspaceId} file={file} variant="default" />
    </div>
  )
}

function DownloadButton({ workspaceId, file, variant = 'outline', size = 'sm', className }) {
  const [busy, setBusy] = useState(false)
  if (!file) return null
  const go = async () => {
    setBusy(true)
    const url = await getSignedUrl(workspaceId, file.id, { download: true })
    setBusy(false)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = file.original_filename || 'document'
    a.rel = 'noopener'
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  return (
    <Button variant={variant} size={size} onClick={go} disabled={busy} className={className}>
      {busy ? <Spinner size="sm" /> : <Download />} Download
    </Button>
  )
}

/**
 * Shows the current version of a document: page images with zoom, a PDF, a
 * readable text card or a download card. Includes download and fullscreen.
 */
export function DocumentViewer({ workspaceId, document: doc, versionId, className, minHeightClass = 'min-h-[60svh] lg:min-h-[70svh]' }) {
  const [full, setFull] = useState(false)
  const info = useMemo(() => describeVersionFiles(doc?.files, versionId ?? doc?.current_version_id), [doc?.files, versionId, doc?.current_version_id])

  useEffect(() => {
    if (!full) return undefined
    const onKey = (e) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [full])

  let body
  if (info.mode === 'images') body = <ImagesMode workspaceId={workspaceId} pages={info.pages} />
  else if (info.mode === 'pdf') body = <PdfMode workspaceId={workspaceId} file={info.pdf} />
  else if (info.mode === 'text') body = <TextMode workspaceId={workspaceId} documentId={doc.id} file={info.textFile} />
  else if (info.mode === 'file') body = <FileMode workspaceId={workspaceId} file={info.original} document={doc} />
  else body = (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <FileText className="size-8" />
      <p className="text-sm">No file to show yet.</p>
    </div>
  )

  return (
    <div className={cn(full ? 'fixed inset-0 z-50 flex flex-col bg-background' : cn('relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft', minHeightClass), className)}>
      <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
        <span className="truncate px-1 text-sm text-muted-foreground">{full ? doc?.name : info.original?.original_filename || ''}</span>
        <div className="flex items-center gap-1">
          {info.mode === 'pdf' && info.pdf && (
            <Button variant="ghost" size="sm" onClick={async () => { const u = await getSignedUrl(workspaceId, info.pdf.id); if (u) window.open(u, '_blank', 'noopener') }}>
              <ExternalLink /> Open
            </Button>
          )}
          <DownloadButton workspaceId={workspaceId} file={info.download} variant="ghost" />
          <Button variant="ghost" size="icon-sm" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((v) => !v)}>
            {full ? <Minimize /> : <Maximize />}
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">{body}</div>
    </div>
  )
}

export { DownloadButton }
