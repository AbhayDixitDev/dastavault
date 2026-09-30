import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

const MIN = 0.5
const MAX = 6

/**
 * Image with pinch / wheel zoom, drag pan, rotate and fit-to-screen.
 * `src` is a URL (signed or object URL). Works with mouse and touch through pointer events.
 */
export function ImageViewer({ src, alt = '', className, onReady }) {
  const wrapRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const pointers = useRef(new Map())
  const gesture = useRef(null)

  useEffect(() => {
    setScale(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    setLoaded(false)
  }, [src])

  const clamp = (s) => Math.min(MAX, Math.max(MIN, s))

  const zoomAt = useCallback((factor, cx, cy) => {
    setScale((s) => {
      const next = clamp(s * factor)
      if (cx !== undefined && wrapRef.current) {
        const rect = wrapRef.current.getBoundingClientRect()
        const px = cx - rect.left - rect.width / 2
        const py = cy - rect.top - rect.height / 2
        const ratio = next / s
        setOffset((o) => ({ x: px - (px - o.x) * ratio, y: py - (py - o.y) * ratio }))
      }
      return next
    })
  }, [])

  const onWheel = (e) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 4) return
    e.preventDefault()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)
  }

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      gesture.current = { type: 'pan', startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), startScale: scale }
    }
  }

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan' && pointers.current.size === 1) {
      setOffset({ x: g.ox + (e.clientX - g.startX), y: g.oy + (e.clientY - g.startY) })
    } else if (g.type === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      setScale(clamp(g.startScale * (d / g.dist)))
    }
  }

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) gesture.current = null
    else if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()]
      gesture.current = { type: 'pan', startX: p.x, startY: p.y, ox: offset.x, oy: offset.y }
    }
  }

  const reset = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  // Wheel needs a non-passive listener so we can prevent page scroll.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const h = (e) => onWheel(e)
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [zoomAt]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={cn('relative flex size-full flex-col', className)}>
      <div
        ref={wrapRef}
        className="relative flex flex-1 touch-none items-center justify-center overflow-hidden bg-muted/40 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => (scale > 1.05 ? reset() : zoomAt(2, e.clientX, e.clientY))}
        style={{ cursor: scale > 1 ? 'grab' : 'zoom-in' }}
      >
        {!loaded && <div className="absolute inset-0 flex items-center justify-center"><Spinner label="Opening" /></div>}
        {src && (
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => { setLoaded(true); onReady?.() }}
            className={cn('max-h-full max-w-full object-contain transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`, transformOrigin: 'center center', willChange: 'transform' }}
          />
        )}
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1 rounded-xl border bg-card/90 p-1 shadow-soft backdrop-blur">
        <Button size="icon" variant="ghost" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25)}><ZoomOut /></Button>
        <span className="flex min-w-[3rem] items-center justify-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
        <Button size="icon" variant="ghost" aria-label="Zoom in" onClick={() => zoomAt(1.25)}><ZoomIn /></Button>
        <Button size="icon" variant="ghost" aria-label="Fit to screen" onClick={reset}><Maximize2 /></Button>
        <Button size="icon" variant="ghost" aria-label="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw /></Button>
      </div>
    </div>
  )
}
