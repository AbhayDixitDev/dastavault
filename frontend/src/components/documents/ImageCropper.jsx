import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CropStep } from '@/components/scanner/CropStep'
import { Spinner } from '@/components/ui/spinner'
import { detectDocumentCorners, fullFrameCorners } from '@/services/scanner/detect'
import { perspectiveWarp, rotateCanvas, rotateCorners } from '@/services/scanner/transform'
import { blobToCanvas, canvasToBlob } from '@/services/scanner/imageUtils'
import { isUnavailable } from '@/services/scanner/opencv'

const MAX_SIDE = 2600

/**
 * Full screen crop for a photo picked from the device: finds the paper's
 * edges, lets the user adjust them, rotate, and returns the straightened
 * image as a new File (JPEG).
 */
export function ImageCropper({ file, onDone, onCancel }) {
  const [image, setImage] = useState(null) // canvas
  const [corners, setCorners] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { canvas } = await blobToCanvas(file, MAX_SIDE)
        if (!alive) return
        // The editor opens once the edges are known, so it starts in the right mode.
        const found = await detectDocumentCorners(canvas).catch(() => null)
        if (!alive) return
        setImage(canvas)
        if (found?.ok) setSuggested(found.corners)
        setCorners(found?.ok ? found.corners : fullFrameCorners(canvas.width, canvas.height))
      } catch {
        toast.error('Could not open this photo.')
        onCancel()
      }
    })()
    return () => { alive = false }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!image || !corners) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-white">
        <Spinner label="Finding the edges" />
      </div>
    )
  }

  const rotate = () => {
    const w = image.width
    const h = image.height
    setImage(rotateCanvas(image, 90))
    setCorners(rotateCorners(corners, w, h))
    setSuggested((s) => (s ? rotateCorners(s, w, h) : null))
  }

  const done = async () => {
    setWorking(true)
    try {
      const out = await perspectiveWarp(image, corners)
      const blob = await canvasToBlob(out, 'image/jpeg', 0.9)
      const base = (file.name || 'photo').replace(/\.[^.]+$/, '')
      onDone(new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }))
    } catch {
      toast.error('Could not crop this photo.')
      setWorking(false)
    }
  }

  return (
    <CropStep
      key={`${image.width}x${image.height}`}
      image={image}
      width={image.width}
      height={image.height}
      corners={corners}
      suggested={suggested}
      cvAvailable={!isUnavailable()}
      onChange={setCorners}
      onRotate={rotate}
      onContinue={done}
      onBack={onCancel}
      working={working}
    />
  )
}
