/**
 * PDF helpers built on pdfjs-dist. The worker is bundled by Vite through the
 * `?url` import so it works offline and in the installed app.
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
}

function canvasToBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw this page.'))), type, quality)
  })
}

/** Renders a pdf.js page into an image Blob. */
export async function getPageImage(page, scale = 1.5, { type = 'image/webp', quality = 0.9 } = {}) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, canvas, viewport }).promise
  const blob = await canvasToBlob(canvas, type, quality)
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** Renders a pdf.js page onto a canvas you own (for the viewer). Returns the render task. */
export function renderPageToCanvas(page, canvas, scale = 1.5) {
  const viewport = page.getViewport({ scale })
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.ceil(viewport.width * dpr)
  canvas.height = Math.ceil(viewport.height * dpr)
  canvas.style.width = `${Math.ceil(viewport.width)}px`
  canvas.style.height = `${Math.ceil(viewport.height)}px`
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return page.render({ canvasContext: ctx, canvas, viewport })
}

/** Text of a page. `hasText` is false for scanned pages that only contain a picture. */
export async function getPageText(page) {
  try {
    const content = await page.getTextContent()
    const lines = []
    let line = ''
    let lastY = null
    for (const item of content.items || []) {
      if (!('str' in item)) continue
      const y = item.transform ? item.transform[5] : null
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.trimEnd())
        line = ''
      }
      line += item.str + (item.hasEOL ? '\n' : ' ')
      lastY = y
    }
    if (line) lines.push(line.trimEnd())
    const text = lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length
    return { text, hasText: letters >= 20 }
  } catch {
    return { text: '', hasText: false }
  }
}

/**
 * Opens a PDF blob (or ArrayBuffer / URL) and returns a small handle.
 * Never throws: on failure returns { ok:false, error, numPages: 0 }.
 */
export async function loadPdf(source) {
  try {
    let params
    if (typeof source === 'string') params = { url: source }
    else if (source instanceof ArrayBuffer) params = { data: source }
    else params = { data: await source.arrayBuffer() }
    const doc = await pdfjs.getDocument({ ...params, isEvalSupported: false }).promise
    const pages = new Map()
    const getPage = async (n) => {
      if (!pages.has(n)) pages.set(n, doc.getPage(n))
      return pages.get(n)
    }
    return {
      ok: true,
      numPages: doc.numPages,
      doc,
      getPage,
      getPageImage: async (n, scale = 1.5, opts) => getPageImage(await getPage(n), scale, opts),
      getPageText: async (n) => getPageText(await getPage(n)),
      renderPage: async (n, canvas, scale) => renderPageToCanvas(await getPage(n), canvas, scale),
      getViewport: async (n, scale = 1) => (await getPage(n)).getViewport({ scale }),
      destroy: () => {
        pages.clear()
        return doc.destroy().catch(() => {})
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Could not open this PDF.',
      numPages: 0,
      getPage: async () => null,
      getPageImage: async () => null,
      getPageText: async () => ({ text: '', hasText: false }),
      renderPage: async () => null,
      getViewport: async () => null,
      destroy: () => {},
    }
  }
}

/** First page of a PDF as a small image Blob, for thumbnails. Null on failure. */
export async function pdfThumbnail(blob, { maxSize = 512 } = {}) {
  const pdf = await loadPdf(blob)
  if (!pdf.ok) return null
  try {
    const vp = await pdf.getViewport(1, 1)
    const scale = Math.min(2, maxSize / Math.max(vp.width, vp.height))
    return await pdf.getPageImage(1, scale)
  } catch {
    return null
  } finally {
    pdf.destroy()
  }
}
