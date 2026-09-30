import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { loadPdf } from '@/services/pdf'
import { cn } from '@/lib/utils'

/**
 * Renders one page of a PDF at a time with page navigation and zoom.
 * `blob` is the PDF data (Blob). Nothing is stored in Redux.
 */
export function PdfViewer({ blob, className, onPages }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    let handle = null
    setBusy(true)
    setError('')
    setPdf(null)
    setPage(1)
    if (!blob) return undefined
    loadPdf(blob).then((h) => {
      if (!alive) {
        h.destroy()
        return
      }
      handle = h
      if (!h.ok) {
        setError(h.error || 'Could not open this PDF.')
        setBusy(false)
        return
      }
      setPdf(h)
      onPages?.(h.numPages)
    })
    return () => {
      alive = false
      handle?.destroy()
    }
  }, [blob]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pdf || !canvasRef.current) return undefined
    let task = null
    let cancelled = false
    setBusy(true)
    ;(async () => {
      try {
        const vp = await pdf.getViewport(page, 1)
        const width = wrapRef.current?.clientWidth || 600
        const fit = Math.max(0.3, (width - 24) / vp.width)
        task = await pdf.renderPage(page, canvasRef.current, fit * zoom)
        await task.promise
      } catch (err) {
        if (!cancelled && err?.name !== 'RenderingCancelledException') setError('Could not draw this page.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel?.()
    }
  }, [pdf, page, zoom])

  const numPages = pdf?.numPages ?? 0

  return (
    <div className={cn('relative flex size-full flex-col', className)}>
      <div ref={wrapRef} className="scroll-inside flex flex-1 justify-center overflow-auto bg-muted/40 p-3">
        {error ? (
          <p className="self-center text-sm text-muted-foreground">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="h-fit rounded-md bg-white shadow-soft" />
        )}
        {busy && !error && <div className="absolute inset-0 flex items-center justify-center bg-background/40"><Spinner label="Opening" /></div>}
      </div>
      {numPages > 0 && (
        <div className="absolute right-2 bottom-2 left-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 rounded-xl border bg-card/90 p-1 shadow-soft backdrop-blur">
            <Button size="icon" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft /></Button>
            <span className="min-w-[5.5rem] text-center text-xs tabular-nums">Page {page} of {numPages}</span>
            <Button size="icon" variant="ghost" aria-label="Next page" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}><ChevronRight /></Button>
          </div>
          <div className="flex items-center gap-1 rounded-xl border bg-card/90 p-1 shadow-soft backdrop-blur">
            <Button size="icon" variant="ghost" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}><ZoomOut /></Button>
            <span className="min-w-[3rem] text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="ghost" aria-label="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z * 1.25))}><ZoomIn /></Button>
          </div>
        </div>
      )}
    </div>
  )
}
