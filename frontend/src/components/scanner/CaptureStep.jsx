import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Check, Images, X, Zap, ZapOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { getCv } from '@/services/scanner/opencv'
import { detectDocumentCorners } from '@/services/scanner/detect'
import { canvasToBlob, makeCanvas } from '@/services/scanner/imageUtils'

const LIVE_INTERVAL_MS = 450

/**
 * Full-screen camera view.
 * onCapture(blob, width, height), onImport(FileList), onDone(), onClose()
 */
export function CaptureStep({ pageCount = 0, onCapture, onImport, onDone, onClose, busy = false }) {
  const videoRef = useRef(null)
  const overlayRef = useRef(null)
  const streamRef = useRef(null)
  const trackRef = useRef(null)
  const fileRef = useRef(null)
  const liveRef = useRef({ timer: null, busy: false, cv: null, stop: false })
  const [status, setStatus] = useState('starting') // starting | ready | denied | unavailable
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [flash, setFlash] = useState(false)
  const [shooting, setShooting] = useState(false)

  const stop = useCallback(() => {
    liveRef.current.stop = true
    clearTimeout(liveRef.current.timer)
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    streamRef.current = null
    trackRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('unavailable'); return }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        trackRef.current = track
        try {
          const caps = track.getCapabilities?.()
          setTorchSupported(!!caps?.torch)
        } catch { setTorchSupported(false) }
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setStatus(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'unavailable')
      }
    }
    start()
    return () => { cancelled = true; stop() }
  }, [stop])

  // Live edge preview when the device can do it.
  useEffect(() => {
    if (status !== 'ready') return
    const live = liveRef.current
    live.stop = false
    let work = null
    getCv().then((cv) => { if (!live.stop) live.cv = cv })
    const tick = async () => {
      if (live.stop) return
      const v = videoRef.current
      const overlay = overlayRef.current
      if (live.cv && v && overlay && v.videoWidth && !live.busy && !document.hidden) {
        live.busy = true
        try {
          if (!work) work = makeCanvas(320, 320 * (v.videoHeight / v.videoWidth))
          work.getContext('2d').drawImage(v, 0, 0, work.width, work.height)
          const r = await detectDocumentCorners(work, { cv: live.cv })
          drawOverlay(overlay, v, r.ok ? r.corners.map((c) => ({ x: c.x / work.width, y: c.y / work.height })) : null)
        } catch { /* skip this frame */ }
        live.busy = false
      }
      live.timer = setTimeout(tick, LIVE_INTERVAL_MS)
    }
    live.timer = setTimeout(tick, LIVE_INTERVAL_MS)
    return () => { live.stop = true; clearTimeout(live.timer) }
  }, [status])

  const toggleTorch = async () => {
    const track = trackRef.current
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn(!torchOn)
    } catch { setTorchSupported(false) }
  }

  const shoot = async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth || shooting || busy) return
    setShooting(true)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    try {
      const canvas = makeCanvas(v.videoWidth, v.videoHeight)
      canvas.getContext('2d').drawImage(v, 0, 0)
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95)
      await onCapture?.(blob, canvas.width, canvas.height)
    } catch { /* the page shows nothing new; the user can try again */ } finally {
      setShooting(false)
    }
  }

  const onFiles = (e) => {
    const files = e.target.files
    if (files?.length) onImport?.(Array.from(files))
    e.target.value = ''
  }

  const cameraBlocked = status === 'denied' || status === 'unavailable'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* top bar */}
      <div className="safe-top flex items-center justify-between px-3 pt-3">
        <button type="button" onClick={() => { stop(); onClose?.() }} className="tap-target flex items-center justify-center rounded-full bg-white/10 backdrop-blur" aria-label="Close scanner">
          <X className="size-5" />
        </button>
        <span className="rounded-full bg-white/10 px-3 py-1 text-sm backdrop-blur">
          {pageCount === 0 ? 'No pages yet' : pageCount === 1 ? '1 page' : `${pageCount} pages`}
        </span>
        {torchSupported ? (
          <button type="button" onClick={toggleTorch} className={cn('tap-target flex items-center justify-center rounded-full backdrop-blur', torchOn ? 'bg-brand-amber text-black' : 'bg-white/10')} aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'}>
            {torchOn ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
          </button>
        ) : <span className="size-11" />}
      </div>

      {/* viewfinder */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className={cn('absolute inset-0 size-full object-contain', cameraBlocked && 'hidden')} />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full" />
        {flash && <div className="absolute inset-0 bg-white/80" />}
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner label="Opening the camera..." />
          </div>
        )}
        {cameraBlocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="size-12 text-white/60" />
            <h2 className="font-display text-xl">{status === 'denied' ? 'Camera access is off' : 'No camera found'}</h2>
            <p className="max-w-sm text-sm text-white/70">
              {status === 'denied'
                ? 'Allow camera access in your browser settings to scan with the camera. You can still add photos from your gallery.'
                : 'This device has no camera we can use. You can still add photos from your gallery.'}
            </p>
            <Button size="lg" variant="secondary" onClick={() => fileRef.current?.click()}>
              <Images /> Choose from gallery
            </Button>
          </div>
        )}
        {busy && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <span className="rounded-full bg-black/60 px-4 py-2 text-sm backdrop-blur">Finding the edges...</span>
          </div>
        )}
      </div>

      {/* bottom controls */}
      <div className="safe-bottom flex items-center justify-between px-8 pb-6 pt-4">
        <button type="button" onClick={() => fileRef.current?.click()} className="flex size-14 flex-col items-center justify-center rounded-2xl bg-white/10 backdrop-blur" aria-label="Choose from gallery">
          <Images className="size-6" />
        </button>
        <button
          type="button"
          onClick={shoot}
          disabled={status !== 'ready' || shooting || busy}
          aria-label="Take photo"
          className="flex size-20 items-center justify-center rounded-full border-4 border-white/90 bg-transparent transition-transform active:scale-95 disabled:opacity-40"
        >
          <span className="block size-16 rounded-full bg-white" />
        </button>
        <button
          type="button"
          onClick={() => { stop(); onDone?.() }}
          disabled={pageCount === 0}
          className={cn('flex size-14 items-center justify-center rounded-2xl backdrop-blur', pageCount ? 'bg-primary text-primary-foreground' : 'bg-white/10 opacity-40')}
          aria-label="Finish and review pages"
        >
          <Check className="size-6" />
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
    </div>
  )
}

/** Draw the detected quad (relative coords 0..1) over the letterboxed video. */
function drawOverlay(overlay, video, rel) {
  const rect = overlay.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  if (overlay.width !== Math.round(rect.width * dpr) || overlay.height !== Math.round(rect.height * dpr)) {
    overlay.width = Math.round(rect.width * dpr)
    overlay.height = Math.round(rect.height * dpr)
  }
  const ctx = overlay.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, rect.width, rect.height)
  if (!rel) return
  const vw = video.videoWidth
  const vh = video.videoHeight
  const scale = Math.min(rect.width / vw, rect.height / vh)
  const dw = vw * scale
  const dh = vh * scale
  const ox = (rect.width - dw) / 2
  const oy = (rect.height - dh) / 2
  ctx.beginPath()
  rel.forEach((p, i) => {
    const x = ox + p.x * dw
    const y = oy + p.y * dh
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fillStyle = 'rgba(91, 79, 230, 0.18)'
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(160, 150, 255, 0.95)'
  ctx.stroke()
}
