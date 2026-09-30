import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileDown, Printer, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspace } from '@/hooks/useWorkspace'
import { api } from '@/services/api/client'
import { fetchFileBlob } from '@/services/files/signedUrls'
import { RichContent, RichEditor, htmlToText, sanitizeHtml } from '@/components/editor/RichEditor'
import { htmlToMarkdown, markdownToHtml, textToHtml } from '@/components/editor/markdown'
import { PageTools } from '@/components/editor/PageTools'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorBox, errorMessage } from '@/components/common/ErrorBox'

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .dv-print, .dv-print * { visibility: visible !important; }
  .dv-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; background: #fff; color: #000; }
  .dv-print .tiptap a { color: #000; }
  @page { margin: 2cm; }
}
@media screen { .dv-print { display: none; } }
`

const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/html', 'text/x-markdown']
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function downloadText(name, text, mime = 'text/markdown') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * /w/:ws/documents/:id/edit
 * Written docs and text uploads (TXT, MD, HTML, DOCX) open in the editor; every save is a new version.
 * Scans and PDFs open the page tools.
 */
export function DocumentEditPage() {
  const { workspaceId, can } = useWorkspace()
  const { id } = useParams()
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [mode, setMode] = useState(null) // 'text' | 'pages' | 'none'
  const [html, setHtml] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [loadNote, setLoadNote] = useState('')
  const [saveOpen, setSaveOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const editorRef = useRef(null)
  const canEdit = can('editor')

  useEffect(() => {
    let alive = true
    setError(null)
    setMode(null)
    ;(async () => {
      try {
        const res = await api.get(`/workspaces/${workspaceId}/documents/${id}`)
        const d = res.document
        if (!alive) return
        setDoc(d)
        setName(d.name || '')

        // 1. Written document (or any doc with stored content)
        let content = null
        if (d.document_type === 'written') {
          content = await api.get(`/workspaces/${workspaceId}/documents/${id}/content`).catch(() => null)
        } else {
          content = await api.get(`/workspaces/${workspaceId}/documents/${id}/content`).catch(() => null)
        }
        if (!alive) return
        if (content && typeof content.content_html === 'string' && content.content_html) {
          setHtml(sanitizeHtml(content.content_html))
          setMode('text')
          return
        }

        // 2. Uploaded text-like file in the current version
        const files = (d.files || []).filter((f) => !d.current_version_id || f.version_id === d.current_version_id)
        const original = files.find((f) => f.kind === 'original') || files[0]
        const mime = String(original?.mime_type || '')
        const ext = String(original?.original_filename || '').split('.').pop()?.toLowerCase()
        if (original && (TEXT_MIMES.includes(mime) || DOCX_MIME === mime || ['txt', 'md', 'markdown', 'html', 'htm', 'docx'].includes(ext))) {
          const blob = await fetchFileBlob(workspaceId, original.id)
          if (!alive) return
          if (!blob) throw new Error('Could not download the file.')
          let converted = ''
          if (mime === DOCX_MIME || ext === 'docx') {
            const mammoth = await import('mammoth')
            const r = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() })
            converted = r.value || '<p></p>'
            if (r.messages?.length) setLoadNote('Some formatting from the Word file could not be kept.')
          } else if (mime.includes('markdown') || ext === 'md' || ext === 'markdown') {
            converted = markdownToHtml(await blob.text())
          } else if (mime === 'text/html' || ext === 'html' || ext === 'htm') {
            converted = await blob.text()
          } else {
            converted = textToHtml(await blob.text())
          }
          if (!alive) return
          setHtml(sanitizeHtml(converted))
          setLoadNote((n) => n || 'The original file stays as version 1. Saving makes a new version.')
          setMode('text')
          return
        }

        // 3. Scans / PDFs
        const hasPages = files.some((f) => String(f.mime_type || '').startsWith('image/') || String(f.mime_type || '') === 'application/pdf')
        setMode(hasPages ? 'pages' : 'none')
      } catch (err) {
        if (alive) setError(err)
      }
    })()
    return () => {
      alive = false
    }
  }, [workspaceId, id, reloadKey])

  const saveVersion = async () => {
    setSaving(true)
    try {
      const content_html = editorRef.current?.getHTML() || html
      const content_text = editorRef.current?.getText() || htmlToText(content_html)
      if (name.trim() && name.trim() !== doc.name) {
        await api.patch(`/workspaces/${workspaceId}/documents/${id}`, { name: name.trim() }).catch(() => null)
      }
      await api.put(`/workspaces/${workspaceId}/documents/${id}/written`, { content_html, content_text, comment: comment.trim() || undefined })
      setDirty(false)
      setSaveOpen(false)
      setComment('')
      toast.success('Saved as a new version.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const exportPdf = () => {
    setTimeout(() => window.print(), 50)
  }

  const downloadMarkdown = () => {
    const current = editorRef.current?.getHTML() || html
    const md = `# ${name || doc?.name || 'Document'}\n\n${htmlToMarkdown(current)}`
    downloadText(`${(name || doc?.name || 'document').replace(/[^\w.-]+/g, '_')}.md`, md)
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorBox error={error} title="Could not open this document" onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    )
  }
  if (!doc || mode === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    )
  }

  const back = (
    <Button asChild variant="ghost">
      <Link to={`/w/${workspaceId}/documents/${id}`}><ArrowLeft /> Back</Link>
    </Button>
  )

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={doc.name} description="You need editor access to change this document." actions={back} />
        {mode === 'text' && <RichContent html={html} />}
      </div>
    )
  }

  if (mode === 'pages') {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title={doc.name} description="Rotate, reorder, crop, add or remove pages. Saving keeps the old version." actions={back} />
        <PageTools workspaceId={workspaceId} document={doc} onSaved={() => navigate(`/w/${workspaceId}/documents/${id}`)} />
      </div>
    )
  }

  if (mode === 'none') {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={doc.name} description="This file type cannot be edited here yet." actions={back} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Edit document"
        description={loadNote || (dirty ? 'Unsaved changes' : `Version history is kept. Each save makes a new version.`)}
        actions={
          <>
            {back}
            <Button variant="outline" onClick={exportPdf}><Printer /> <span className="hidden sm:inline">Export PDF</span></Button>
            <Button variant="outline" onClick={downloadMarkdown}><FileDown /> <span className="hidden sm:inline">Markdown</span></Button>
            <Button onClick={() => setSaveOpen(true)}><Save /> Save as new version</Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} placeholder="Document name" className="h-12 text-lg" />
        <RichEditor ref={editorRef} valueHtml={html} onChange={({ html: h }) => { setHtml(h); setDirty(true) }} placeholder="Start writing..." minHeight="24rem" />
      </div>

      <div className="dv-print">
        <h1 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>{name || doc.name}</h1>
        <RichContent html={html} />
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as new version</DialogTitle>
            <DialogDescription>The earlier version stays in the history.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="de-comment">What changed? (optional)</Label>
            <Input id="de-comment" value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1.5" placeholder="Fixed the dates" autoFocus />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveVersion} disabled={saving}>{saving && <Spinner size="sm" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default DocumentEditPage
