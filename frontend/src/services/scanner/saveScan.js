/**
 * Turn finished scan pages into queued uploads.
 *
 *   saveScan({ workspaceId, pages, name, document_type, person_ids, group_ids, asPdf, people, groups, onStatus })
 *     -> { ok, id, error }
 *
 * Uses src/services/files (sha256Hex, makeThumbnail, compressImage) when present,
 * with local fallbacks otherwise. Originals are always kept.
 */
import { enqueueUpload } from '@/services/offline/uploadQueue'
import { buildPdf } from './pdfBuilder.js'
import { blobToCanvas, canvasToBlob, makeCanvas } from './imageUtils.js'

const fileModules = import.meta.glob('../files/index.js')

async function filesModule() {
  const loader = fileModules['../files/index.js']
  if (!loader) return null
  try { return await loader() } catch { return null }
}

export async function sha256Fallback(blob) {
  try {
    const buf = await blob.arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

async function compressFallback(blob, { maxWidthOrHeight = 2200, quality = 0.85 } = {}) {
  try {
    const { canvas } = await blobToCanvas(blob, maxWidthOrHeight)
    let q = quality
    let out = await canvasToBlob(canvas, 'image/jpeg', q)
    while (out.size > 1.5 * 1024 * 1024 && q > 0.5) {
      q -= 0.1
      out = await canvasToBlob(canvas, 'image/jpeg', q)
    }
    return out
  } catch {
    return blob
  }
}

async function thumbnailFallback(blob, maxSize = 512) {
  try {
    const { canvas } = await blobToCanvas(blob, maxSize)
    const out = makeCanvas(canvas.width, canvas.height)
    out.getContext('2d').drawImage(canvas, 0, 0)
    return await canvasToBlob(out, 'image/webp', 0.8).catch(() => canvasToBlob(out, 'image/jpeg', 0.8))
  } catch {
    return null
  }
}

export async function prepareFile(blob, { compress = true } = {}) {
  const mod = await filesModule()
  let out = blob
  if (compress) {
    if (typeof mod?.compressImage === 'function') {
      try {
        const f = blob instanceof File ? blob : new File([blob], 'page.jpg', { type: blob.type || 'image/jpeg' })
        out = await mod.compressImage(f, { maxSizeMB: 1.5, maxWidthOrHeight: 2200 })
      } catch {
        out = await compressFallback(blob)
      }
    } else {
      out = await compressFallback(blob)
    }
  }
  const sha = typeof mod?.sha256Hex === 'function' ? await mod.sha256Hex(out).catch(() => sha256Fallback(out)) : await sha256Fallback(out)
  return { blob: out, sha256: sha }
}

export async function makeThumb(blob) {
  const mod = await filesModule()
  if (typeof mod?.makeThumbnail === 'function') {
    try { return await mod.makeThumbnail(blob, { maxSize: 512 }) } catch { /* fallback */ }
  }
  return thumbnailFallback(blob)
}

/**
 * @param {{ workspaceId, pages: [{ original: Blob, processed: Blob }], name, document_type, person_ids, group_ids, asPdf, people, groups, onStatus }} args
 */
export async function saveScan({ workspaceId, pages = [], name, document_type, person_ids = [], group_ids = [], asPdf = false, people, groups, onStatus } = {}) {
  try {
    if (!workspaceId || !pages.length) return { ok: false, error: 'Nothing to save yet.' }
    const files = []
    const stamp = Date.now()
    const say = (t) => { try { onStatus?.(t) } catch { /* ignore */ } }

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      const pageNumber = i + 1
      say(`Preparing page ${pageNumber} of ${pages.length}`)
      if (p.original) {
        const o = await prepareFile(p.original, { compress: true })
        files.push({ blob: o.blob, sha256: o.sha256, kind: 'original', page_number: pageNumber, name: `scan-${stamp}-original-${pageNumber}.jpg` })
      }
      if (p.processed) {
        const c = await prepareFile(p.processed, { compress: true })
        files.push({ blob: c.blob, sha256: c.sha256, kind: 'processed', page_number: pageNumber, name: `scan-${stamp}-page-${pageNumber}.jpg` })
      }
    }

    const firstProcessed = files.find((f) => f.kind === 'processed' && f.page_number === 1) || files.find((f) => f.kind === 'original')
    if (firstProcessed) {
      const thumb = await makeThumb(firstProcessed.blob)
      if (thumb) files.push({ blob: thumb, kind: 'thumbnail', page_number: 1, name: `scan-${stamp}-thumb.${thumb.type === 'image/webp' ? 'webp' : 'jpg'}`, sha256: await sha256Fallback(thumb) })
    }

    if (asPdf) {
      say('Combining pages into one PDF')
      const processedBlobs = files.filter((f) => f.kind === 'processed').sort((a, b) => a.page_number - b.page_number).map((f) => f.blob)
      const pdf = await buildPdf(processedBlobs.length ? processedBlobs : files.filter((f) => f.kind === 'original').map((f) => f.blob), { title: name || 'Scan' })
      if (pdf) files.push({ blob: pdf, kind: 'pdf', page_number: null, name: `${(name || 'scan').replace(/[^a-z0-9 _-]/gi, '').trim() || 'scan'}.pdf`, sha256: await sha256Fallback(pdf) })
    }

    say('Saving on this device')
    const id = await enqueueUpload({ workspaceId, files, name, document_type, person_ids, group_ids, people, groups })
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not save this scan.' }
  }
}
