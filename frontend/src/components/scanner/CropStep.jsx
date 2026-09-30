import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Move, RotateCw, Scan, Sparkles, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { orderCorners, fullFrameCorners } from '@/services/scanner/detect'

const HIT_R = 30 // handles accept touches within a 60px circle (44px minimum target)
const LOUPE_SIZE = 110
const LOUPE_ZOOM = 2.2

function boundsOf(corners) {
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

function rectFrom(corners) {
  const b = boundsOf(corners)
  return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }]
}

function isRect(corners) {
  const [tl, tr, br, bl] = corners
  return Math.abs(tl.y - tr.y) < 0.5 && Math.abs(bl.y - br.y) < 0.5 && Math.abs(tl.x - bl.x) < 0.5 && Math.abs(tr.x - br.x) < 0.5
}

/**
 * Crop editor.
 * props: image (drawable of the working, already rotated image), width, height,
 *        corners, suggested, cvAvailable, onChange(corners), onRotate(), onReset(),
 *        onContinue(), onBack()
 */
export function CropStep({ image, width, height, corners, suggested, cvAvailable = true, onChange, onRotate, onContinue, onBack, working = false }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [mode, setMode] = useState(() => (corners && !isRect(corners) ? 'corners' : 'rect'))
  const stateRef = useRef({ corners, drag: null, fit: null, mode })
  const [, force] = useState(0)

  const fit = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || !width || !height) return null
    const pad = 28
    const cw = wrap.clientWidth
    const ch = wrap.clientHeight
    const scale = Math.min((cw - pad * 2) / width, (ch - pad * 2) / height)
    const dw = width * scale
    const dh = height * scale
    return { scale, ox: (cw - dw) / 2, oy: (ch - dh) / 2, cw, ch, dw, dh }
  }, [width, height])

  const toScreen = (p, f) => ({ x: f.ox + p.x * f.scale, y: f.oy + p.y * f.scale })
  const toImage = (p, f) => ({ x: Math.max(0, Math.min(width, (p.x - f.ox) / f.scale)), y: Math.max(0, Math.min(height, (p.y - f.oy) / f.scale)) })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const f = fit()
    if (!canvas || !f || !image) return
    stateRef.current.fit = f
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(f.cw * dpr) || canvas.height !== Math.round(f.ch * dpr)) {
      canvas.width = Math.round(f.cw * dpr)
      canvas.height = Math.round(f.ch * dpr)
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, f.cw, f.ch)
    ctx.drawImage(image, f.ox, f.oy, f.dw, f.dh)

    const c = stateRef.current.corners || fullFrameCorners(width, height)
    const pts = c.map((p) => toScreen(p, f))

    // Dim outside the quad.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, f.cw, f.ch)
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 3; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill('evenodd')
    ctx.restore()

    // Quad outline.
    ctx.beginPath()
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(91,79,230,0.9)'
    ctx.stroke()

    const active = stateRef.current.drag
    const drawHandle = (p, kind, id) => {
      const isActive = active && active.id === id
      ctx.beginPath()
      ctx.arc(p.x, p.y, kind === 'corner' ? 11 : 8, 0, Math.PI * 2)
      ctx.fillStyle = isActive ? 'rgb(91,79,230)' : 'rgba(255,255,255,0.95)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = isActive ? '#fff' : 'rgba(91,79,230,0.9)'
      ctx.stroke()
    }
    pts.forEach((p, i) => drawHandle(p, 'corner', `c${i}`))
    if (stateRef.current.mode === 'rect') {
      for (let i = 0; i < 4; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % 4]
        drawHandle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'edge', `e${i}`)
      }
    }

    // Magnifier near the active handle (corners mode).
    if (active && stateRef.current.mode === 'corners' && active.id.startsWith('c')) {
      const idx = +active.id[1]
      const ip = c[idx]
      const sp = pts[idx]
      const size = LOUPE_SIZE
      let lx = sp.x - size / 2
      let ly = sp.y - size - 40
      if (ly < 8) ly = sp.y + 40
      lx = Math.max(8, Math.min(f.cw - size - 8, lx))
      const src = size / LOUPE_ZOOM / f.scale
      ctx.save()
      ctx.beginPath()
      ctx.arc(lx + size / 2, ly + size / 2, size / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      ctx.fillStyle = '#000'
      ctx.fillRect(lx, ly, size, size)
      ctx.drawImage(image, ip.x - src / 2, ip.y - src / 2, src, src, lx, ly, size, size)
      ctx.strokeStyle = 'rgba(91,79,230,0.95)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(lx + size / 2, ly)
      ctx.lineTo(lx + size / 2, ly + size)
      ctx.moveTo(lx, ly + size / 2)
      ctx.lineTo(lx + size, ly + size / 2)
      ctx.stroke()
      ctx.restore()
      ctx.beginPath()
      ctx.arc(lx + size / 2, ly + size / 2, size / 2, 0, Math.PI * 2)
      ctx.lineWidth = 3
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
  }, [fit, image, width, height])

  useEffect(() => {
    stateRef.current.corners = corners
    stateRef.current.mode = mode
    draw()
  }, [corners, mode, draw])

  useEffect(() => {
    draw()
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [draw])

  const hitTest = (sp) => {
    const f = stateRef.current.fit
    const c = stateRef.current.corners
    if (!f || !c) return null
    const pts = c.map((p) => toScreen(p, f))
    let best = null
    const consider = (id, p) => {
      const d = Math.hypot(p.x - sp.x, p.y - sp.y)
      if (d <= HIT_R && (!best || d < best.d)) best = { id, d }
    }
    pts.forEach((p, i) => consider(`c${i}`, p))
    if (stateRef.current.mode === 'rect') {
      for (let i = 0; i < 4; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % 4]
        consider(`e${i}`, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
    return best?.id || null
  }

  const pointerPos = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e) => {
    const sp = pointerPos(e)
    const id = hitTest(sp)
    if (!id) return
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    stateRef.current.drag = { id, pointerId: e.pointerId }
    draw()
  }

  const onPointerMove = (e) => {
    const drag = stateRef.current.drag
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    const f = stateRef.current.fit
    const ip = toImage(pointerPos(e), f)
    const c = stateRef.current.corners.map((p) => ({ ...p }))
    const idx = +drag.id[1]
    if (stateRef.current.mode === 'corners') {
      c[idx] = ip
    } else if (drag.id[0] === 'c') {
      // Keep a rectangle: a corner moves its two neighbours' shared coordinates.
      const b = boundsOf(c)
      const minSize = 20
      if (idx === 0) { b.x0 = Math.min(ip.x, b.x1 - minSize); b.y0 = Math.min(ip.y, b.y1 - minSize) }
      if (idx === 1) { b.x1 = Math.max(ip.x, b.x0 + minSize); b.y0 = Math.min(ip.y, b.y1 - minSize) }
      if (idx === 2) { b.x1 = Math.max(ip.x, b.x0 + minSize); b.y1 = Math.max(ip.y, b.y0 + minSize) }
      if (idx === 3) { b.x0 = Math.min(ip.x, b.x1 - minSize); b.y1 = Math.max(ip.y, b.y0 + minSize) }
      c.splice(0, 4, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 })
    } else {
      const b = boundsOf(c)
      const minSize = 20
      if (idx === 0) b.y0 = Math.min(ip.y, b.y1 - minSize)
      if (idx === 1) b.x1 = Math.max(ip.x, b.x0 + minSize)
      if (idx === 2) b.y1 = Math.max(ip.y, b.y0 + minSize)
      if (idx === 3) b.x0 = Math.min(ip.x, b.x1 - minSize)
      c.splice(0, 4, { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 })
    }
    stateRef.current.corners = c
    draw()
  }

  const endDrag = (e) => {
    const drag = stateRef.current.drag
    if (!drag || drag.pointerId !== e.pointerId) return
    stateRef.current.drag = null
    const c = stateRef.current.mode === 'corners' ? orderCorners(stateRef.current.corners) : stateRef.current.corners
    stateRef.current.corners = c
    onChange?.(c)
    draw()
    force((n) => n + 1)
  }

  const useSuggested = () => {
    if (!suggested) return
    setMode(isRect(suggested) ? 'rect' : 'corners')
    onChange?.(suggested.map((p) => ({ ...p })))
  }

  const toggleMode = () => {
    if (mode === 'rect') {
      setMode('corners')
    } else {
      setMode('rect')
      onChange?.(rectFrom(stateRef.current.corners))
    }
  }

  const reset = () => {
    onChange?.(fullFrameCorners(width, height))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="safe-top flex items-center justify-between px-3 pt-3">
        <Button variant="ghost" size="icon-lg" className="rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onBack} aria-label="Back">
          <ArrowLeft />
        </Button>
        <span className="font-display text-base">Crop and straighten</span>
        <span className="size-10" />
      </div>

      <div ref={wrapRef} className="relative min-h-0 flex-1 touch-none select-none">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 size-full touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        />
        {!cvAvailable && (
          <div className="pointer-events-none absolute inset-x-4 top-3 rounded-xl bg-black/60 px-3 py-2 text-center text-xs text-white/90 backdrop-blur">
            Automatic edge detection is not available on this device. Adjust the corners yourself.
          </div>
        )}
        {cvAvailable && suggested && (
          <div className="pointer-events-none absolute inset-x-4 top-3 rounded-xl bg-black/50 px-3 py-2 text-center text-xs text-white/80 backdrop-blur">
            {mode === 'corners' ? 'Drag any corner. Hold to zoom in.' : 'Drag the edges or corners to fit the page.'}
          </div>
        )}
      </div>

      <div className="safe-bottom px-4 pb-5 pt-3">
        <div className="mb-3 grid grid-cols-4 gap-2">
          <ToolButton icon={Sparkles} label="Suggested" onClick={useSuggested} disabled={!suggested} />
          <ToolButton icon={mode === 'rect' ? Move : Scan} label={mode === 'rect' ? 'Adjust corners' : 'Rectangle'} onClick={toggleMode} active={mode === 'corners'} />
          <ToolButton icon={Undo2} label="Reset" onClick={reset} />
          <ToolButton icon={RotateCw} label="Rotate" onClick={onRotate} />
        </div>
        <Button size="xl" className="w-full" onClick={onContinue} disabled={working}>
          {working ? 'Straightening...' : 'Continue'} <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

function ToolButton({ icon: Icon, label, onClick, disabled, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] leading-tight transition-colors', active ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/20', disabled && 'opacity-40')}
    >
      <Icon className="size-5" />
      <span className="text-center">{label}</span>
    </button>
  )
}
