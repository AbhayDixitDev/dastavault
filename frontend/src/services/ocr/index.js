import { cleanLines } from './cleanText.js'

/**
 * Reading text from images and PDFs (contract section 10).
 *
 *   readText(blob, { lang = 'eng', onProgress }) -> { ok, text, confidence, words }
 *   readDocument({ files, pages }, { lang, onProgress }) -> { ok, text, language, confidence, pages }
 *
 * Tesseract.js runs in its own Web Worker (cached between calls, terminated after
 * two minutes idle while the page is hidden). Page images are pre-cleaned in
 * src/workers/ocr.worker.js. PDF pages with embedded text skip reading entirely.
 * Nothing here throws.
 */

export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'hin', label: 'Hindi' },
  { code: 'mar', label: 'Marathi' },
  { code: 'guj', label: 'Gujarati' },
  { code: 'ben', label: 'Bengali' },
  { code: 'tam', label: 'Tamil' },
  { code: 'tel', label: 'Telugu' },
  { code: 'kan', label: 'Kannada' },
  { code: 'mal', label: 'Malayalam' },
  { code: 'pan', label: 'Punjabi' },
  { code: 'urd', label: 'Urdu' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
]

const LANG_KEY = 'dv.ocrLang'
/** Language data that ships with the app (scripts/copy-ocr.mjs); others download once. */
const SHIPPED_LANGS = ['eng', 'hin']
/** Long side of the picture for the quick reading and for the detailed one. */
const QUICK_SIDE = 2000
const DETAIL_SIDE = 3200
/** A reading at least this sure is kept without a second look. */
const SURE = 0.8
const IDLE_MS = 2 * 60 * 1000
const MIN_PDF_TEXT = 50

export function getDefaultLanguage() {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v && v.split('+').every((c) => OCR_LANGUAGES.some((x) => x.code === c))) return v
  } catch { /* storage blocked */ }
  // Indian documents mix Hindi and English; English alone turns the Hindi
  // lines into noise that spoils names and numbers (both ship with the app).
  return 'eng+hin'
}

export function setDefaultLanguage(lang) {
  try { localStorage.setItem(LANG_KEY, lang || 'eng') } catch { /* ignore */ }
}

function normaliseLang(lang) {
  const codes = String(lang || 'eng').split('+').map((c) => c.trim()).filter((c) => OCR_LANGUAGES.some((l) => l.code === c))
  if (!codes.length) codes.push('eng')
  if (!codes.includes('eng')) codes.push('eng')
  return codes.join('+')
}

/* ------------------------------------------------- pre-clean worker */

let prepWorker = null
let prepSeq = 0
const prepPending = new Map()

function getPrepWorker() {
  if (prepWorker) return prepWorker
  try {
    prepWorker = new Worker(new URL('../../workers/ocr.worker.js', import.meta.url), { type: 'module' })
    prepWorker.onmessage = (e) => {
      const { id } = e.data || {}
      const p = prepPending.get(id)
      if (p) { prepPending.delete(id); p.resolve(e.data) }
    }
    prepWorker.onerror = () => {
      for (const p of prepPending.values()) p.resolve({ ok: false })
      prepPending.clear()
      try { prepWorker.terminate() } catch { /* ignore */ }
      prepWorker = null
    }
  } catch {
    prepWorker = null
  }
  return prepWorker
}

async function prepareImage(blob, maxSide) {
  const w = getPrepWorker()
  if (!w) return blob
  try {
    const id = ++prepSeq
    const result = await new Promise((resolve) => {
      prepPending.set(id, { resolve })
      w.postMessage({ id, blob, maxSide })
      setTimeout(() => { if (prepPending.has(id)) { prepPending.delete(id); resolve({ ok: false }) } }, 20000)
    })
    return result?.ok && result.blob ? result.blob : blob
  } catch {
    return blob
  }
}

/* ------------------------------------------------- tesseract worker */

let tess = null // { worker, langs, promise }
let idleTimer = null
let listenersBound = false

function bindLifecycle() {
  if (listenersBound || typeof document === 'undefined') return
  listenersBound = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { if (!busy) terminateReader() }, IDLE_MS)
    } else {
      clearTimeout(idleTimer)
    }
  })
}

let busy = 0

async function getReader(langs, onProgress) {
  bindLifecycle()
  if (tess && tess.langs === langs) return tess.promise
  if (tess) await terminateReader()
  const promise = (async () => {
    const { createWorker } = await import('tesseract.js')
    const options = { logger: (m) => progressRouter(m) }
    // The reader and its English data ship with the app (scripts/copy-ocr.mjs):
    // nothing to download before the first photo is read. English and Hindi ship
    // with the app; other languages come from the CDN once and are cached.
    const local = (path) => new URL(`${import.meta.env.BASE_URL || '/'}tesseract/${path}`, window.location.href).href
    options.workerPath = import.meta.env?.VITE_TESSERACT_WORKER_PATH || local('worker.min.js')
    options.corePath = import.meta.env?.VITE_TESSERACT_CORE_PATH || local('core')
    if (import.meta.env?.VITE_TESSERACT_LANG_PATH) options.langPath = import.meta.env.VITE_TESSERACT_LANG_PATH
    else if (langs.split('+').every((l) => SHIPPED_LANGS.includes(l))) options.langPath = local('lang')
    const worker = await createWorker(langs.split('+'), 1, options)
    return worker
  })()
  tess = { langs, promise }
  promise.catch(() => { if (tess?.promise === promise) tess = null })
  currentProgress = onProgress
  return promise
}

let currentProgress = null
function progressRouter(m) {
  if (!currentProgress || !m) return
  try {
    if (m.status === 'recognizing text') currentProgress({ stage: 'reading', progress: m.progress ?? 0 })
    else if (/loading|initializ/i.test(m.status || '')) currentProgress({ stage: 'preparing', progress: m.progress ?? 0 })
  } catch { /* ignore listener errors */ }
}

/**
 * Starts the reader in the background (worker, engine, language data) so the
 * first photo is read without that wait. Safe to call often.
 */
export function warmUpReader(lang) {
  getReader(normaliseLang(lang || getDefaultLanguage())).catch(() => {})
  getPrepWorker()
}

export async function terminateReader() {
  const t = tess
  tess = null
  if (!t) return
  try {
    const w = await t.promise
    await w.terminate()
  } catch { /* ignore */ }
}

function wordsFrom(data) {
  const out = []
  try {
    const blocks = data?.blocks || []
    for (const b of blocks) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
      out.push({ text: w.text, bbox: w.bbox, confidence: (w.confidence || 0) / 100 })
    }
  } catch { /* partial */ }
  return out
}

function linesFrom(data) {
  const out = []
  try {
    for (const b of data?.blocks || []) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) out.push({ text: String(l.text || '').trim(), confidence: (l.confidence || 0) / 100, words: (l.words || []).map((w) => ({ text: w.text, confidence: (w.confidence || 0) / 100 })) })
        out.push(null) // paragraph break
      }
    }
  } catch { /* partial */ }
  return out
}

/**
 * Read text from one image blob.
 */
export async function readText(blob, { lang, onProgress } = {}) {
  const langs = normaliseLang(lang || getDefaultLanguage())
  const empty = { ok: false, text: '', confidence: 0, words: [], language: langs }
  if (!blob || typeof blob.arrayBuffer !== 'function') return empty
  busy++
  try {
    onProgress?.({ stage: 'preparing', progress: 0 })
    const worker = await getReader(langs, onProgress)
    currentProgress = onProgress
    const pass = async (maxSide) => {
      const cleaned = await prepareImage(blob, maxSide)
      const { data } = await worker.recognize(cleaned, {}, { text: true, blocks: true })
      // Lines the reader was unsure of (the table, other papers, handwriting) are left out.
      const text = cleanLines(linesFrom(data)) || String(data?.text || '').replace(/[ \t]+\n/g, '\n').trim()
      const confidence = Math.max(0, Math.min(1, (data?.confidence || 0) / 100))
      return { text, confidence: text.length ? confidence : 0, data }
    }
    // Quick look first. A document that is small in the photo (a card on a
    // table) has tiny letters at that size, so an unsure result is read again
    // at full detail and the surer reading is kept.
    let best = await pass(QUICK_SIDE)
    if (best.confidence < SURE || best.text.replace(/\s/g, '').length < 25) {
      const detailed = await pass(DETAIL_SIDE)
      if (detailed.confidence > best.confidence) best = detailed
    }
    onProgress?.({ stage: 'reading', progress: 1 })
    return { ok: best.text.length > 0, text: best.text, confidence: best.confidence, words: wordsFrom(best.data), lines: linesFrom(best.data), language: langs }
  } catch {
    // A broken reader should not poison the next call.
    await terminateReader()
    return empty
  } finally {
    busy--
    currentProgress = null
  }
}

/* --------------------------------------------------------- PDF text */

const pdfModules = import.meta.glob('../pdf/index.js')

async function loadPdfModule() {
  const loader = pdfModules['../pdf/index.js']
  if (!loader) return null
  try {
    const mod = await loader()
    return typeof mod?.loadPdf === 'function' ? mod : null
  } catch {
    return null
  }
}

function isPdf(file) {
  return file?.kind === 'pdf' || /pdf$/i.test(file?.mime_type || '') || /\.pdf$/i.test(file?.blob?.name || file?.name || '')
}

function isImage(file) {
  return /^image\//i.test(file?.mime_type || file?.blob?.type || '')
}

/**
 * Read a whole document: pre-rendered pages, then processed images, then originals, then PDFs.
 */
export async function readDocument({ files = [], pages = [] } = {}, { lang, onProgress, maxPages = Infinity } = {}) {
  const langs = normaliseLang(lang || getDefaultLanguage())
  // complete: every page was read (false when maxPages stopped early)
  const result = { ok: false, text: '', language: langs, confidence: 0, pages: [], complete: true }
  try {
    const list = Array.isArray(files) ? files.filter((f) => f?.blob) : []
    const processed = list.filter((f) => f.kind === 'processed' && isImage(f))
    const originals = list.filter((f) => (f.kind === 'original' || !f.kind) && isImage(f))
    const pdfs = list.filter(isPdf)
    const images = processed.length ? processed : originals

    let pageInputs = []
    if (Array.isArray(pages) && pages.length) {
      pageInputs = pages.map((p, i) => ({ page_number: p.page_number ?? i + 1, blob: p.blob, text: p.text }))
    } else if (images.length) {
      pageInputs = images
        .slice()
        .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))
        .map((f, i) => ({ page_number: f.page_number ?? i + 1, blob: f.blob }))
    }
    const totalPages = pageInputs.length
    pageInputs = pageInputs.slice(0, maxPages)

    const total = { count: 0 }
    const report = (i, n, stage, p) => onProgress?.({ stage, page: i + 1, pages: n, progress: Math.min(1, (i + (p || 0)) / Math.max(1, n)) })

    if (!pageInputs.length && pdfs.length) {
      const pdfMod = await loadPdfModule()
      if (pdfMod) {
        let pdf = null
        try {
          pdf = await pdfMod.loadPdf(pdfs[0].blob)
          const n = Math.min(pdf.numPages || 0, maxPages)
          result.complete = n >= (pdf.numPages || 0)
          for (let i = 0; i < n; i++) {
            const pageNumber = i + 1
            let text = ''
            let confidence = 0
            try {
              const t = await pdf.getPageText(pageNumber)
              if (t?.hasText && String(t.text || '').trim().length > MIN_PDF_TEXT) { text = String(t.text).trim(); confidence = 0.99 }
            } catch { /* fall back to reading the image */ }
            if (!text) {
              report(i, n, 'reading', 0)
              try {
                const img = await pdf.getPageImage(pageNumber, 2)
                const r = await readText(img, { lang: langs, onProgress: (p) => report(i, n, p.stage, p.progress) })
                text = r.text
                confidence = r.confidence
              } catch { /* keep empty page */ }
            } else {
              report(i, n, 'reading', 1)
            }
            result.pages.push({ page_number: pageNumber, text, confidence })
          }
        } finally {
          try { pdf?.destroy?.() } catch { /* ignore */ }
        }
      }
    } else {
      result.complete = pageInputs.length >= totalPages
      const n = pageInputs.length
      for (let i = 0; i < n; i++) {
        const p = pageInputs[i]
        if (p.text && String(p.text).trim()) {
          result.pages.push({ page_number: p.page_number, text: String(p.text).trim(), confidence: 0.99 })
          continue
        }
        report(i, n, 'reading', 0)
        const r = await readText(p.blob, { lang: langs, onProgress: (pr) => report(i, n, pr.stage, pr.progress) })
        result.pages.push({ page_number: p.page_number, text: r.text, confidence: r.confidence })
        total.count++
      }
    }

    const withText = result.pages.filter((p) => p.text)
    result.text = result.pages.map((p) => p.text).filter(Boolean).join('\n\n').trim()
    result.confidence = withText.length ? +(withText.reduce((s, p) => s + p.confidence, 0) / withText.length).toFixed(3) : 0
    result.ok = result.text.length > 0
    onProgress?.({ stage: 'done', progress: 1 })
    return result
  } catch {
    return result
  }
}
