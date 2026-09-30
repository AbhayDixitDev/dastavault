import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Crop, Plus, RotateCcw, RotateCw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api/client'
import { fetchFileBlob } from '@/services/files/signedUrls'
import { errorMessage } from '@/components/common/ErrorBox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/* ---------- helpers (never throw to the UI; they return null) ---------- */

async function loadPdfService() {
  try {
    return await import('@/services/pdf/index.js')
  } catch {
    return null
  }
}

function loadImage(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Draws a blob to a canvas applying crop (fractions) and rotation; returns a JPEG blob. */
async function renderImage(blob, { crop, rotation = 0, quality = 0.9 } = {}) {
  const img = await loadImage(blob)
  if (!img) return null
  const sx = crop ? Math.round(crop.x * img.width) : 0
  const sy = crop ? Math.round(crop.y * img.height) : 0
  const sw = crop ? Math.max(1, Math.round(crop.w * img.width)) : img.width
  const sh = crop ? Math.max(1, Math.round(crop.h * img.height)) : img.height
  const rot = ((rotation % 360) + 360) % 360
  const canvas = document.createElement('canvas')
  const swap = rot === 90 || rot === 270
  canvas.width = swap ? sh : sw
  canvas.height = swap ? sw : sh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality))
}

/** Small preview blob of a page image (for the thumbnail strip). */
async function thumbOf(blob, max = 320) {
  const img = await loadImage(blob)
  if (!img) return blob
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.8))
}

let seq = 0
const nextId = () => `p${Date.now()}-${seq++}`

/**
 * Page tools for scanned images and PDFs: thumbnails, rotate, reorder, delete, add, crop,
 * then "Save as new version" which builds a new PDF with pdf-lib and uploads it.
 *
 * props: { workspaceId, document, onSaved(version) }
 * document = GET /documents/:id payload (needs files[] and current_version_id).
 */
export function PageTools({ workspaceId, document: doc, onSaved }) {
  const [pages, setPages] = useState(null) // [{ id, source: { type:'image', blob } | { type:'pdf', blob, index }, rotation, crop, thumbUrl }]
  const [loadError, setLoadError] = useState('')
  const [cropTarget, setCropTarget] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [comment, setComment] = useState('Pages edited')
  const fileInput = useRef(null)
  const dirty = useRef(false)

  /* ---------- load current version pages ---------- */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const files = (doc?.files || []).filter((f) => !doc.current_version_id || f.version_id === doc.current_version_id)
        const images = files
          .filter((f) => (f.kind === 'original' || f.kind === 'processed') && String(f.mime_type || '').startsWith('image/'))
          .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))
        // prefer processed pages when they exist (one per page)
        const processed = images.filter((f) => f.kind === 'processed')
        const pageImages = processed.length ? processed : images.filter((f) => f.kind === 'original')
        const pdf = files.find((f) => String(f.mime_type || '') === 'application/pdf' && (f.kind === 'original' || f.kind === 'pdf'))

        const out = []
        if (pageImages.length) {
          for (const f of pageImages) {
            const blob = await fetchFileBlob(workspaceId, f.id)
            if (!blob) continue
            out.push({ id: nextId(), source: { type: 'image', blob }, rotation: 0, crop: null, thumbUrl: URL.createObjectURL(await thumbOf(blob)) })
          }
        } else if (pdf) {
          const blob = await fetchFileBlob(workspaceId, pdf.id)
          const svc = await loadPdfService()
          if (!blob || !svc) throw new Error('Could not open this PDF.')
          const handle = await svc.loadPdf(blob)
          if (!handle.ok) throw new Error(handle.error || 'Could not open this PDF.')
          for (let n = 1; n <= handle.numPages; n++) {
            const img = await handle.getPageImage(n, 0.4, { type: 'image/jpeg', quality: 0.8 })
            out.push({ id: nextId(), source: { type: 'pdf', blob, index: n - 1 }, rotation: 0, crop: null, thumbUrl: img ? URL.createObjectURL(img) : '' })
          }
          handle.destroy()
        }
        if (!alive) return
        setPages(out)
        if (!out.length) setLoadError('This document has no pages that can be edited here.')
      } catch (err) {
        if (alive) setLoadError(err?.message || 'Could not load the pages.')
      }
    })()
    return () => {
      alive = false
    }
  }, [doc, workspaceId])

  const update = (fn) => {
    dirty.current = true
    setPages((p) => fn([...p]))
  }
  const rotate = (i, delta) => update((p) => { p[i] = { ...p[i], rotation: (p[i].rotation + delta + 360) % 360 }; return p })
  const move = (i, dir) => update((p) => {
    const j = i + dir
    if (j < 0 || j >= p.length) return p
    ;[p[i], p[j]] = [p[j], p[i]]
    return p
  })
  const remove = (i) => update((p) => { p.splice(i, 1); return p })

  const addFiles = async (list) => {
    const files = Array.from(list || [])
    if (!files.length) return
    const added = []
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        added.push({ id: nextId(), source: { type: 'image', blob: f }, rotation: 0, crop: null, thumbUrl: URL.createObjectURL(await thumbOf(f)) })
      } else if (f.type === 'application/pdf') {
        const svc = await loadPdfService()
        if (!svc) {
          toast.error('PDF support is not available right now.')
          continue
        }
        const handle = await svc.loadPdf(f)
        for (let n = 1; n <= handle.numPages; n++) {
          const img = await handle.getPageImage(n, 0.4, { type: 'image/jpeg', quality: 0.8 })
          added.push({ id: nextId(), source: { type: 'pdf', blob: f, index: n - 1 }, rotation: 0, crop: null, thumbUrl: img ? URL.createObjectURL(img) : '' })
        }
        handle.destroy()
      } else toast.error(`${f.name}: only photos and PDFs can be added.`)
    }
    if (added.length) update((p) => [...p, ...added])
  }

  /* ---------- build and upload ---------- */
  const save = async () => {
    if (!pages?.length) return toast.error('Add at least one page.')
    setSaving(true)
    try {
      const { PDFDocument, degrees } = await import('pdf-lib')
      const out = await PDFDocument.create()
      const sourceDocs = new Map() // blob -> PDFDocument
      const svc = await loadPdfService()

      for (const page of pages) {
        if (page.source.type === 'pdf' && !page.crop) {
          let src = sourceDocs.get(page.source.blob)
          if (!src) {
            src = await PDFDocument.load(await page.source.blob.arrayBuffer(), { ignoreEncryption: true })
            sourceDocs.set(page.source.blob, src)
          }
          const [copied] = await out.copyPages(src, [page.source.index])
          const existing = copied.getRotation().angle || 0
          copied.setRotation(degrees((existing + page.rotation) % 360))
          out.addPage(copied)
          continue
        }
        // image page, or a cropped PDF page rendered to an image
        let blob = page.source.blob
        if (page.source.type === 'pdf') {
          if (!svc) throw new Error('PDF support is not available right now.')
          const handle = await svc.loadPdf(page.source.blob)
          blob = await handle.getPageImage(page.source.index + 1, 2, { type: 'image/jpeg', quality: 0.92 })
          handle.destroy()
          if (!blob) throw new Error('Could not render a page.')
        }
        const jpeg = await renderImage(blob, { crop: page.crop, rotation: page.rotation })
        if (!jpeg) throw new Error('Could not read one of the pages.')
        const bytes = await jpeg.arrayBuffer()
        const img = await out.embedJpg(bytes)
        const p = out.addPage([img.width, img.height])
        p.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
      }

      const pdfBytes = await out.save()
      const file = new File([pdfBytes], `${(doc?.name || 'document').replace(/[^\w.-]+/g, '_')}.pdf`, { type: 'application/pdf' })
      const fd = new FormData()
      fd.append('files[]', file)
      fd.append('kind', 'pdf')
      fd.append('comment', comment.trim() || 'Pages edited')
      const res = await api.post(`/workspaces/${workspaceId}/documents/${doc.id}/versions`, fd)
      dirty.current = false
      setSaveOpen(false)
      toast.success('Saved as a new version.')
      onSaved?.(res?.version, res)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{loadError}</p>
  if (!pages) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => fileInput.current?.click()}>
          <Plus /> Add pages
        </Button>
        <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <span className="text-sm text-muted-foreground">{pages.length} {pages.length === 1 ? 'page' : 'pages'}</span>
        <Button className="ml-auto" onClick={() => setSaveOpen(true)} disabled={saving || !pages.length}>
          <Save /> Save as new version
        </Button>
      </div>

      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {pages.map((p, i) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-xl border bg-card p-2">
            <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-muted">
              {p.thumbUrl ? (
                <img
                  src={p.thumbUrl}
                  alt={`Page ${i + 1}`}
                  className="max-h-full max-w-full object-contain transition-transform"
                  style={{ transform: `rotate(${p.rotation}deg)` }}
                />
              ) : (
                <span className="text-xs text-muted-foreground">Page {i + 1}</span>
              )}
              <span className="absolute left-1.5 top-1.5 rounded-md bg-background/90 px-1.5 text-xs font-medium">{i + 1}</span>
              {p.crop && <span className="absolute right-1.5 top-1.5 rounded-md bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">Cropped</span>}
            </div>
            <div className="grid grid-cols-6 gap-1">
              <Tool label="Rotate left" onClick={() => rotate(i, -90)}><RotateCcw /></Tool>
              <Tool label="Rotate right" onClick={() => rotate(i, 90)}><RotateCw /></Tool>
              <Tool label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp /></Tool>
              <Tool label="Move down" onClick={() => move(i, 1)} disabled={i === pages.length - 1}><ArrowDown /></Tool>
              <Tool label="Crop" onClick={() => setCropTarget(i)}><Crop /></Tool>
              <Tool label="Delete page" onClick={() => remove(i)} className="text-destructive"><Trash2 /></Tool>
            </div>
          </li>
        ))}
      </ol>

      <CropDialog
        page={cropTarget != null ? pages[cropTarget] : null}
        onClose={() => setCropTarget(null)}
        onApply={(crop) => {
          update((p) => { p[cropTarget] = { ...p[cropTarget], crop }; return p })
          setCropTarget(null)
        }}
      />

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as new version</DialogTitle>
            <DialogDescription>The pages are joined into one PDF. The earlier version is kept.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="pt-comment">What changed?</Label>
            <Input id="pt-comment" value={comment} onChange={(e) => setComment(e.target.value)} className="mt-1.5" placeholder="Pages edited" />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Spinner size="sm" />} Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Tool({ label, className, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('flex h-9 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30 [&_svg]:size-4', className)}
      {...props}
    >
      {children}
    </button>
  )
}

/** Simple rectangle crop: drag on the page image. Crop is stored as fractions of the full image. */
function CropDialog({ page, onClose, onApply }) {
  const [imgUrl, setImgUrl] = useState('')
  const [rect, setRect] = useState(null) // fractions { x, y, w, h }
  const drag = useRef(null)
  const box = useRef(null)

  useEffect(() => {
    if (!page) {
      setImgUrl('')
      setRect(null)
      return undefined
    }
    let alive = true
    let url = ''
    ;(async () => {
      let blob = page.source.blob
      if (page.source.type === 'pdf') {
        const svc = await loadPdfService()
        if (svc) {
          const handle = await svc.loadPdf(page.source.blob)
          blob = (await handle.getPageImage(page.source.index + 1, 1.2, { type: 'image/jpeg', quality: 0.85 })) || blob
          handle.destroy()
        }
      }
      if (!alive) return
      url = URL.createObjectURL(blob)
      setImgUrl(url)
      setRect(page.crop || { x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [page])

  const frac = (e) => {
    const b = box.current.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }
  }
  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = frac(e)
    setRect({ ...drag.current, w: 0, h: 0 })
  }
  const onMove = (e) => {
    if (!drag.current) return
    const p = frac(e)
    setRect({ x: Math.min(p.x, drag.current.x), y: Math.min(p.y, drag.current.y), w: Math.abs(p.x - drag.current.x), h: Math.abs(p.y - drag.current.y) })
  }
  const onUp = () => {
    drag.current = null
  }

  const valid = rect && rect.w > 0.02 && rect.h > 0.02

  return (
    <Dialog open={!!page} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crop page</DialogTitle>
          <DialogDescription>Drag on the page to choose the part to keep.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div
            ref={box}
            className="relative mx-auto max-h-[60svh] w-fit touch-none select-none overflow-hidden rounded-lg bg-muted"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            {imgUrl ? <img src={imgUrl} alt="" className="block max-h-[60svh] max-w-full" draggable={false} style={{ transform: `rotate(${page?.rotation || 0}deg)` }} /> : <Skeleton className="h-80 w-60" />}
            {rect && (
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
              />
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          {page?.crop && <Button variant="ghost" className="sm:mr-auto" onClick={() => onApply(null)}>Remove crop</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApply(rect)} disabled={!valid}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PageTools
