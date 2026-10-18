import { useEffect, useRef, useState } from 'react'
import { Check, X, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const OUT_SIZE = 512

/**
 * Fit a photo (fills its parent; PersonDialog shows it full screen) into a round profile frame. Drag to move, pinch or
 * use the slider to zoom. `face` ({ x, y, w, h } as parts of the photo) places
 * the frame on a face found beforehand. onDone(canvas) gets a 512px square.
 */
export function ProfileCropper({ file, face, onDone, onCancel }) {
  const [img, setImg] = useState(null)
  const [frame, setFrame] = useState(300)
  const [view, setView] = useState(null) // { zoom, x, y } x/y: image top-left inside the frame
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => setImg(image)
    image.onerror = () => onCancel()
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const size = () => setFrame(Math.min(window.innerWidth - 48, window.innerHeight - 260, 420))
    size()
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [])

  const base = img ? frame / Math.min(img.naturalWidth, img.naturalHeight) : 1

  const clamp = (v, z = v.zoom) => {
    const w = img.naturalWidth * base * z
    const h = img.naturalHeight * base * z
    return { zoom: z, x: Math.min(0, Math.max(frame - w, v.x)), y: Math.min(0, Math.max(frame - h, v.y)) }
  }

  // Start on the face (about half the frame), else in the middle.
  useEffect(() => {
    if (!img) return
    const w = img.naturalWidth * base
    const h = img.naturalHeight * base
    if (face) {
      const zoom = Math.max(1, Math.min(5, (0.5 * frame) / (face.w * w)))
      const cx = (face.x + face.w / 2) * w * zoom
      const cy = (face.y + face.h / 2) * h * zoom
      setView(clamp({ zoom, x: frame / 2 - cx, y: frame / 2 - cy }, zoom))
    } else {
      setView(clamp({ zoom: 1, x: (frame - w) / 2, y: (frame - h) / 2 }, 1))
    }
  }, [img, frame]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomTo = (zoom, cx = frame / 2, cy = frame / 2) => {
    setView((v) => {
      const z = Math.max(1, Math.min(5, zoom))
      const k = z / v.zoom
      return clamp({ zoom: z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, z)
    })
  }

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom }
    }
  }
  const onMove = (e) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev || !view) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const rect = wrapRef.current.getBoundingClientRect()
      zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top)
    } else if (pointers.current.size === 1) {
      setView((v) => clamp({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }))
    }
  }
  const onUp = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const done = () => {
    const scale = base * view.zoom
    const out = document.createElement('canvas')
    out.width = OUT_SIZE
    out.height = OUT_SIZE
    out.getContext('2d').drawImage(img, -view.x / scale, -view.y / scale, frame / scale, frame / scale, 0, 0, OUT_SIZE, OUT_SIZE)
    onDone(out)
  }

  return (
    <div className="flex size-full flex-col items-center justify-center gap-5 bg-black px-6 text-white">
      <p className="text-center text-sm text-white/80">Move and zoom so the face fills the circle.</p>
      <div
        ref={wrapRef}
        className="relative touch-none overflow-hidden rounded-xl select-none"
        style={{ width: frame, height: frame }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {!img || !view ? (
          <div className="flex size-full items-center justify-center"><Spinner /></div>
        ) : (
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none"
            style={{ width: img.naturalWidth * base * view.zoom, height: img.naturalHeight * base * view.zoom, transform: `translate(${view.x}px, ${view.y}px)` }}
          />
        )}
        {/* Dim everything outside the circle. */}
        <div className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80" />
      </div>
      {view && (
        <label className="flex w-full max-w-xs items-center gap-3">
          <ZoomIn className="size-5 shrink-0" />
          <input type="range" min="1" max="5" step="0.01" value={view.zoom} onChange={(e) => zoomTo(Number(e.target.value))} className="w-full accent-white" aria-label="Zoom" />
        </label>
      )}
      <div className="flex w-full max-w-xs gap-3">
        <Button variant="outline" className="flex-1 border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={onCancel}><X /> Cancel</Button>
        <Button className="flex-1" onClick={done} disabled={!view}><Check /> Use photo</Button>
      </div>
    </div>
  )
}
