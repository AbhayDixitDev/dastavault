import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Plus, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { enhance } from '@/services/scanner/transform'
import { toCanvas } from '@/services/scanner/imageUtils'

const MODES = [
  { key: 'auto', label: 'Auto' },
  { key: 'color', label: 'Colour' },
  { key: 'grayscale', label: 'Grayscale' },
  { key: 'bw', label: 'Black & white' },
]

/**
 * Preview of the straightened page with filters.
 * props: warped (canvas), settings {mode, brightness, contrast}, onSettings(patch),
 *        onRetake(), onAddPage(), onDone(), onBack(), working
 */
export function EnhanceStep({ warped, settings, onSettings, onRetake, onAddPage, onDone, onBack, working = false }) {
  const displayRef = useRef(null)
  const previewRef = useRef(null)
  const [rendering, setRendering] = useState(false)

  // Small copy for fast previews.
  useEffect(() => {
    previewRef.current = warped ? toCanvas(warped, 1100).canvas : null
  }, [warped])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      const src = previewRef.current
      const display = displayRef.current
      if (!src || !display) return
      setRendering(true)
      requestAnimationFrame(() => {
        if (cancelled) return
        const out = enhance(src, settings.mode, { brightness: settings.brightness, contrast: settings.contrast })
        display.width = out.width
        display.height = out.height
        display.getContext('2d').drawImage(out, 0, 0)
        setRendering(false)
      })
    }, 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [warped, settings.mode, settings.brightness, settings.contrast])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="safe-top flex items-center justify-between px-3 pt-3">
        <Button variant="ghost" size="icon-lg" className="rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={onBack} aria-label="Back to crop">
          <ArrowLeft />
        </Button>
        <span className="font-display text-base">Make it clear</span>
        <span className="size-10" />
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {!warped ? (
          <Spinner label="Straightening..." />
        ) : (
          <canvas ref={displayRef} className="max-h-full max-w-full rounded-md object-contain shadow-lift" />
        )}
        {rendering && <span className="absolute bottom-6 rounded-full bg-black/60 px-3 py-1 text-xs backdrop-blur">Updating...</span>}
      </div>

      <div className="safe-bottom space-y-3 px-4 pb-5 pt-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => onSettings({ mode: m.key })}
              className={cn('tap-target shrink-0 rounded-full px-4 text-sm transition-colors', settings.mode === m.key ? 'bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/20')}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="flex justify-between"><span>Brightness</span><span className="text-white/60">{settings.brightness}</span></span>
            <input type="range" min={-60} max={60} step={1} value={settings.brightness} onChange={(e) => onSettings({ brightness: +e.target.value })} className="accent-primary" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="flex justify-between"><span>Contrast</span><span className="text-white/60">{settings.contrast}</span></span>
            <input type="range" min={-60} max={60} step={1} value={settings.contrast} onChange={(e) => onSettings({ contrast: +e.target.value })} className="accent-primary" />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="secondary" size="lg" className="bg-white/10 text-white hover:bg-white/20" onClick={onRetake} disabled={working}>
            <RefreshCcw /> Retake
          </Button>
          <Button variant="secondary" size="lg" className="bg-white/10 text-white hover:bg-white/20" onClick={onAddPage} disabled={working || !warped}>
            <Plus /> Add page
          </Button>
          <Button size="lg" onClick={onDone} disabled={working || !warped}>
            {working ? 'Saving...' : <><Check /> Done</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
