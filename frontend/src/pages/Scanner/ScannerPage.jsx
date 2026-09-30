import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Camera, FileStack, Images, RefreshCcw, WifiOff } from 'lucide-react'
import dayjs from 'dayjs'
import { useWorkspace } from '@/hooks/useWorkspace'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CaptureStep } from '@/components/scanner/CaptureStep'
import { CropStep } from '@/components/scanner/CropStep'
import { EnhanceStep } from '@/components/scanner/EnhanceStep'
import { PagesStep } from '@/components/scanner/PagesStep'
import { SaveSheet } from '@/components/scanner/SaveSheet'
import { useScanState, hydrateScan, addPage, updatePage, removePage, movePage, reorderPages, clearScan, setScanWorkspace } from '@/components/scanner/scanStore'
import { getCv } from '@/services/scanner/opencv'
import { detectDocumentCorners, fullFrameCorners } from '@/services/scanner/detect'
import { perspectiveWarp, rotateCanvas, rotateCorners, enhance } from '@/services/scanner/transform'
import { loadImage, sourceSize, releaseDrawable, canvasToBlob } from '@/services/scanner/imageUtils'
import { saveScan } from '@/services/scanner/saveScan'
import { waitForUpload, onUploadChange, retryUpload, startUploadQueue } from '@/services/offline/uploadQueue'
import { UPLOAD_STATUS } from '@/services/offline/db'

/**
 * Route: /w/:ws/scan
 * Steps: start -> capture -> crop -> enhance -> review -> saving
 */
export function ScannerPage() {
  const { workspaceId } = useWorkspace()
  const navigate = useNavigate()
  const scan = useScanState()
  const pages = scan.pages
  const [step, setStep] = useState('loading')
  const [activeId, setActiveId] = useState(null)
  const [cvAvailable, setCvAvailable] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [working, setWorking] = useState(null)
  const [warped, setWarped] = useState(null)
  const [warping, setWarping] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [output, setOutput] = useState('images')
  const [save, setSave] = useState({ text: '', error: null, id: null, status: null })
  const replaceIndexRef = useRef(null)
  const fileRef = useRef(null)

  const active = pages.find((p) => p.id === activeId) || null
  const defaultName = `Scan - ${dayjs().format('D MMM YYYY')}`

  useEffect(() => {
    let cancelled = false
    setScanWorkspace(workspaceId)
    hydrateScan(workspaceId).then((n) => {
      if (cancelled) return
      setStep(n > 0 ? 'start' : 'capture')
    })
    return () => { cancelled = true }
  }, [workspaceId])

  useEffect(() => {
    getCv().then((cv) => setCvAvailable(!!cv))
    startUploadQueue()
  }, [])

  /* ------------------------------------------------------ ingest */

  const ingest = useCallback(async (blob) => {
    const bitmap = await loadImage(blob)
    const { width, height } = sourceSize(bitmap)
    let det = { ok: false, corners: null }
    try { det = await detectDocumentCorners(bitmap) } catch { /* fall back to the full frame */ }
    releaseDrawable(bitmap)
    const corners = det.ok ? det.corners : fullFrameCorners(width, height)
    return addPage({ original: blob, width, height, corners, suggested: det.ok ? det.corners : null, detected: det.ok })
  }, [])

  const pagesRef = useRef(pages)
  useEffect(() => { pagesRef.current = pages }, [pages])

  const placeReplacement = (id) => {
    const idx = replaceIndexRef.current
    replaceIndexRef.current = null
    if (idx == null) return
    const list = pagesRef.current
    const from = list.findIndex((p) => p.id === id)
    if (from >= 0 && idx < list.length) reorderPages(from, Math.min(idx, list.length - 1))
  }

  const openCrop = useCallback(async (id) => {
    const page = pagesRef.current.find((p) => p.id === id)
    if (!page) return
    try {
      const bitmap = await loadImage(page.original)
      const canvas = rotateCanvas(bitmap, page.rotation || 0)
      releaseDrawable(bitmap)
      setWorking(canvas)
      setActiveId(id)
      setWarped(null)
      setStep('crop')
    } catch {
      toast.error('Could not open this page. Please take it again.')
      removePage(id)
      setStep('capture')
    }
  }, [])

  const onCapture = async (blob) => {
    setDetecting(true)
    try {
      const id = await ingest(blob)
      placeReplacement(id)
      await openCrop(id)
    } catch {
      toast.error('Could not use that photo. Please try again.')
    } finally {
      setDetecting(false)
    }
  }

  const onImport = async (files) => {
    setDetecting(true)
    const ids = []
    try {
      for (const f of files) {
        if (!/^image\//.test(f.type)) continue
        ids.push(await ingest(f))
      }
      if (ids.length === 1) { placeReplacement(ids[0]); await openCrop(ids[0]) }
      else if (ids.length > 1) setStep('review')
      else toast.error('Please choose image files.')
    } catch {
      toast.error('Could not use those photos. Please try again.')
    } finally {
      setDetecting(false)
    }
  }

  /* -------------------------------------------------------- crop */

  const onCorners = (corners) => { if (active) updatePage(active.id, { corners }) }

  const onRotate = () => {
    if (!active || !working) return
    const w = working.width
    const h = working.height
    const next = rotateCanvas(working, 90)
    setWorking(next)
    updatePage(active.id, {
      rotation: ((active.rotation || 0) + 90) % 360,
      width: next.width,
      height: next.height,
      corners: rotateCorners(active.corners, w, h),
      suggested: active.suggested ? rotateCorners(active.suggested, w, h) : null,
      processed: null,
    })
  }

  const onCropContinue = async () => {
    if (!active || !working) return
    setWarping(true)
    setStep('enhance')
    setWarped(null)
    try {
      const out = await perspectiveWarp(working, active.corners)
      setWarped(out)
    } catch {
      toast.error('Could not straighten this page.')
      setStep('crop')
    } finally {
      setWarping(false)
    }
  }

  const onCropBack = () => {
    if (!active) { setStep(pages.length ? 'review' : 'capture'); return }
    if (!active.processed && pages.length === 1) {
      removePage(active.id)
      setActiveId(null)
      setStep('capture')
    } else {
      setStep('review')
    }
  }

  /* ----------------------------------------------------- enhance */

  const settings = { mode: active?.mode || 'auto', brightness: active?.brightness || 0, contrast: active?.contrast || 0 }
  const onSettings = (patch) => { if (active) updatePage(active.id, { ...patch, processed: null }) }

  const commit = async () => {
    if (!active || !warped) return false
    setCommitting(true)
    try {
      const out = enhance(warped, settings.mode, { brightness: settings.brightness, contrast: settings.contrast })
      const blob = await canvasToBlob(out, 'image/jpeg', 0.92)
      updatePage(active.id, { processed: blob, mode: settings.mode, brightness: settings.brightness, contrast: settings.contrast })
      return true
    } catch {
      toast.error('Could not save this page.')
      return false
    } finally {
      setCommitting(false)
    }
  }

  const onRetake = () => {
    if (!active) return
    replaceIndexRef.current = pages.findIndex((p) => p.id === active.id)
    removePage(active.id)
    setActiveId(null)
    setWarped(null)
    setStep('capture')
  }

  const onAddPage = async () => { if (await commit()) { setActiveId(null); setWarped(null); setStep('capture') } }
  const onEnhanceDone = async () => { if (await commit()) { setActiveId(null); setWarped(null); setStep('review') } }

  /* ------------------------------------------------------ review */

  const onReviewRetake = (id) => {
    replaceIndexRef.current = pages.findIndex((p) => p.id === id)
    removePage(id)
    setStep('capture')
  }

  const onDiscard = () => {
    if (!window.confirm('Discard this scan? The pages will be removed from this device.')) return
    clearScan()
    setStep('capture')
  }

  const ensureProcessed = async (p) => {
    if (p.processed) return p.processed
    const bitmap = await loadImage(p.original)
    const canvas = rotateCanvas(bitmap, p.rotation || 0)
    releaseDrawable(bitmap)
    const w = await perspectiveWarp(canvas, p.corners)
    const out = enhance(w, p.mode || 'auto', { brightness: p.brightness || 0, contrast: p.contrast || 0 })
    const blob = await canvasToBlob(out, 'image/jpeg', 0.92)
    updatePage(p.id, { processed: blob })
    return blob
  }

  const onSave = async ({ name, document_type, person_ids, group_ids, people, groups }) => {
    setSaveOpen(false)
    setStep('saving')
    setSave({ text: 'Preparing pages', error: null, id: null, status: null })
    const list = pagesRef.current
    const out = []
    try {
      for (let i = 0; i < list.length; i++) {
        setSave((s) => ({ ...s, text: `Cleaning page ${i + 1} of ${list.length}` }))
        out.push({ original: list[i].original, processed: await ensureProcessed(list[i]) })
      }
    } catch {
      setSave({ text: '', error: 'Could not prepare the pages. Please try again.', id: null, status: null })
      return
    }
    const r = await saveScan({ workspaceId, pages: out, name: name || defaultName, document_type, person_ids, group_ids, asPdf: output === 'pdf', people, groups, onStatus: (t) => setSave((s) => ({ ...s, text: t })) })
    if (!r.ok) {
      setSave({ text: '', error: r.error || 'Could not save this scan.', id: null, status: null })
      return
    }
    clearScan()
    const online = navigator.onLine !== false
    setSave({ text: online ? 'Uploading' : 'Saved on this device. Will upload when online.', error: null, id: r.id, status: UPLOAD_STATUS.SAVED_ON_DEVICE })
    const unsub = onUploadChange((item) => {
      if (item?.id !== r.id) return
      setSave((s) => ({ ...s, text: item.statusText || s.text, status: item.status, error: item.status === UPLOAD_STATUS.FAILED ? item.error : null }))
    })
    const item = await waitForUpload(r.id)
    unsub()
    if (item?.status === UPLOAD_STATUS.UPLOADED && item.documentId) {
      toast.success('Uploaded. Reading the text now.')
      navigate(`/w/${workspaceId}/documents/${item.documentId}`, { replace: true })
    } else if (!item) {
      navigate(`/w/${workspaceId}/documents`, { replace: true })
    }
  }

  /* ------------------------------------------------------ render */

  if (step === 'loading') return <div className="flex justify-center py-16"><Spinner label="Opening the scanner..." /></div>

  if (step === 'capture') {
    return <CaptureStep pageCount={pages.length} busy={detecting} onCapture={onCapture} onImport={onImport} onDone={() => setStep('review')} onClose={() => (pages.length ? setStep('review') : navigate(`/w/${workspaceId}`))} />
  }

  if (step === 'crop' && active && working) {
    return (
      <CropStep
        image={working}
        width={working.width}
        height={working.height}
        corners={active.corners}
        suggested={active.suggested}
        cvAvailable={cvAvailable}
        onChange={onCorners}
        onRotate={onRotate}
        onContinue={onCropContinue}
        onBack={onCropBack}
        working={warping}
      />
    )
  }

  if (step === 'enhance' && active) {
    return (
      <EnhanceStep
        warped={warped}
        settings={settings}
        onSettings={onSettings}
        onRetake={onRetake}
        onAddPage={onAddPage}
        onDone={onEnhanceDone}
        onBack={() => setStep('crop')}
        working={committing || warping}
      />
    )
  }

  if (step === 'saving') {
    const failed = save.status === UPLOAD_STATUS.FAILED || (!!save.error && !save.id)
    const offline = navigator.onLine === false
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-2xl border bg-card p-6 text-center shadow-soft">
          {failed ? (
            <>
              <h2 className="font-display text-xl">Could not upload yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">{save.error || 'Something went wrong.'}</p>
              <div className="mt-5 flex flex-col gap-2">
                {save.id ? (
                  <Button onClick={() => { retryUpload(save.id); setSave((s) => ({ ...s, status: UPLOAD_STATUS.SAVED_ON_DEVICE, error: null, text: 'Waiting to upload' })) }}><RefreshCcw /> Try again</Button>
                ) : (
                  <Button onClick={() => setStep('review')}>Back to pages</Button>
                )}
                <Button variant="outline" onClick={() => navigate(`/w/${workspaceId}/documents`)}>Go to documents</Button>
              </div>
            </>
          ) : (
            <>
              <Spinner size="lg" />
              <h2 className="mt-4 font-display text-xl">{save.status === UPLOAD_STATUS.UPLOADED ? 'Uploaded' : 'Saving your scan'}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{save.text}</p>
              {offline && save.id && (
                <Alert variant="warning" className="mt-4 text-left">
                  <WifiOff className="size-4" />
                  <AlertTitle>Waiting for internet connection.</AlertTitle>
                  <AlertDescription>Saved on this device. Will upload when online. You can keep using the app.</AlertDescription>
                </Alert>
              )}
              {save.id && (
                <Button variant="outline" className="mt-5" onClick={() => navigate(`/w/${workspaceId}/documents`)}>Go to documents</Button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  if (step === 'start') {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Scan" description="Take photos of papers and cards. We straighten them, read the text and make them searchable." />
        {pages.length > 0 && (
          <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
            <FileStack className="size-8 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Continue your scan</p>
              <p className="text-sm text-muted-foreground">{pages.length === 1 ? '1 page is' : `${pages.length} pages are`} waiting on this device.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onDiscard}>Start over</Button>
              <Button onClick={() => setStep('review')}>Continue</Button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setStep('capture')} className="flex items-center gap-4 rounded-2xl border bg-card p-5 text-left transition-colors hover:bg-accent">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Camera className="size-6" /></span>
            <span><span className="block font-medium">Open camera</span><span className="block text-sm text-muted-foreground">Scan one or many pages.</span></span>
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-4 rounded-2xl border bg-card p-5 text-left transition-colors hover:bg-accent">
            <span className="flex size-12 items-center justify-center rounded-xl bg-brand-amber/20 text-amber-700 dark:text-amber-300"><Images className="size-6" /></span>
            <span><span className="block font-medium">Choose from gallery</span><span className="block text-sm text-muted-foreground">Use photos you already took.</span></span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files || []); e.target.value = ''; if (f.length) onImport(f) }} />
        {detecting && <div className="mt-6 flex justify-center"><Spinner label="Finding the edges..." /></div>}
      </div>
    )
  }

  // review
  return (
    <>
      <PagesStep
        pages={pages}
        output={output}
        onOutput={setOutput}
        onMove={movePage}
        onReorder={reorderPages}
        onDelete={(id) => { removePage(id); if (pagesRef.current.length <= 1) setStep('capture') }}
        onRetake={onReviewRetake}
        onEdit={openCrop}
        onAddPage={() => setStep('capture')}
        onSave={() => setSaveOpen(true)}
        onDiscard={onDiscard}
      />
      {save.error && <Alert variant="destructive" className="mt-4"><AlertTitle>Could not save</AlertTitle><AlertDescription>{save.error}</AlertDescription></Alert>}
      <SaveSheet open={saveOpen} onOpenChange={setSaveOpen} defaultName={defaultName} pageCount={pages.length} onSave={onSave} />
    </>
  )
}

export default ScannerPage
