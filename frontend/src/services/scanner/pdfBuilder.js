/**
 * Combine page images into one PDF with pdf-lib (one page per image, JPEG embedded).
 *   buildPdf(blobs: Blob[]) -> Promise<Blob | null>
 */
import { blobToCanvas, canvasToBlob } from './imageUtils.js'

async function asJpeg(blob) {
  if (blob.type === 'image/jpeg') return blob
  const { canvas } = await blobToCanvas(blob)
  return canvasToBlob(canvas, 'image/jpeg', 0.9)
}

export async function buildPdf(blobs, { title = 'Scan' } = {}) {
  try {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    pdf.setTitle(title)
    pdf.setProducer('DastaVault')
    pdf.setCreator('DastaVault')
    for (const blob of blobs) {
      const jpeg = await asJpeg(blob)
      const bytes = new Uint8Array(await jpeg.arrayBuffer())
      const image = await pdf.embedJpg(bytes)
      const page = pdf.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
    }
    const out = await pdf.save()
    return new Blob([out], { type: 'application/pdf' })
  } catch {
    return null
  }
}
