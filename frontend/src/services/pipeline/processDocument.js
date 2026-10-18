/**
 * After-upload pipeline (contract section 10).
 *
 *   processDocument({ workspaceId, documentId, versionId, files, people, groups, onStatus })
 *     -> { ok, textOk, suggestionsOk, embeddingsOk }
 *
 *   read text -> PUT /documents/:id/text
 *   -> extract suggestions + name -> PUT /documents/:id/suggestions
 *   -> chunk -> PUT /documents/:id/chunks (the server makes the vectors)
 *
 *   reprocessDocument({ workspaceId, documentId, people, groups, onStatus })
 *     downloads the current version's files and runs the same pipeline.
 *
 * Every step is independent; nothing here throws.
 */
import { api } from '@/services/api/client'
import { readDocument } from '@/services/ocr'
import { readWithAi, combineRead } from '@/services/ocr/aiRead'
import { extractSuggestions, suggestDocumentName, mergeAiDetails, chunkText, perceptualHash } from '@/services/extraction'

export const STATUS = {
  READING: 'Reading text from this document...',
  DETAILS: 'Finding details...',
  SEARCHABLE: 'Making it searchable...',
  READY: 'Document is ready to search.',
  NO_TEXT: 'We could not read the text. You can still search by name.',
}

function say(onStatus, text, extra) {
  try { onStatus?.(text, extra) } catch { /* listener errors are not ours */ }
}

export async function processDocument({ workspaceId, documentId, versionId, files = [], people = [], groups = [], workspaceKind, lang, onStatus, alreadyRead = null, alreadyFaces = null, linkFaces = true, location = null } = {}) {
  const result = { ok: false, textOk: false, suggestionsOk: false, embeddingsOk: false }
  if (!workspaceId || !documentId) return result
  const base = `/workspaces/${workspaceId}/documents/${documentId}`

  // 1. Read text
  say(onStatus, STATUS.READING, { step: 'text', progress: 0 })
  let read = { ok: false, text: '', language: lang || 'eng', confidence: 0, pages: [] }
  // Text read before the upload (the upload page reads photos to fill in the details) is reused.
  if (alreadyRead?.ok && alreadyRead.complete !== false) {
    read = alreadyRead
  } else {
    try {
      read = await readDocument({ files }, { lang, onProgress: (p) => say(onStatus, STATUS.READING, { step: 'text', progress: p?.progress ?? 0, page: p?.page, pages: p?.pages }) })
    } catch { /* readDocument never throws, belt and braces */ }
  }
  // Handwriting (names, dates, values filled in by hand) is read by the
  // server's vision model from the first page photo.
  if (!read.ai) {
    const photo = files.find((f) => f.kind === 'processed' && (f.page_number ?? 1) === 1 && /^image\//.test(f.mime_type || '') && f.blob)
      || files.find((f) => (f.kind === 'original' || !f.kind) && /^image\//.test(f.mime_type || f.blob?.type || '') && f.blob)
    if (photo) {
      const blob = photo.blob.type ? photo.blob : new Blob([photo.blob], { type: photo.mime_type })
      const ai = await readWithAi(workspaceId, [blob])
      if (ai) read = combineRead(read, ai)
    }
  }
  try {
    await api.put(`${base}/text`, {
      version_id: versionId,
      ocr_text: read.text || '',
      ocr_language: read.language || lang || 'eng',
      ocr_confidence: read.confidence || 0,
      ocr_status: read.ok ? 'done' : (files.length ? 'failed' : 'skipped'),
      pages: (read.pages || []).map((p) => ({ page_number: p.page_number, text: p.text || '', confidence: p.confidence || 0 })),
    })
    result.textOk = true
  } catch { /* the document still exists; it just is not searchable by text yet */ }

  // 2. Details
  say(onStatus, STATUS.DETAILS, { step: 'details' })
  let suggestions = []
  try {
    suggestions = read.text ? extractSuggestions(read.text, { people, groups, workspaceKind }) : []
    suggestions = mergeAiDetails(suggestions, read.ai, { people })
    if (read.text && !suggestions.some((s) => s.key === 'suggested_name')) {
      const name = suggestDocumentName({ suggestions, people, fallbackName: '' })
      if (name) suggestions.push({ key: 'suggested_name', value: name, confidence: 0.4, source: 'rules' })
    }
    if (suggestions.length) {
      await api.put(`${base}/suggestions`, { version_id: versionId, suggestions })
    }
    result.suggestionsOk = true
  } catch { /* suggestions are optional */ }

  // Perceptual hash of the first page, for "may already exist" checks later. Best effort.
  try {
    const first = files.find((f) => f.kind === 'thumbnail' && f.blob) || files.find((f) => f.kind === 'processed' && f.page_number === 1 && f.blob) || files.find((f) => /^image\//.test(f.mime_type || '') && f.blob)
    if (first) {
      const hash = await perceptualHash(first.blob)
      if (hash) await api.patch(`${base}`, { perceptual_hash: hash }).catch(() => {})
    }
  } catch { /* optional */ }

  // Faces on the first page (ID cards, photos): kept with the document, for
  // grouping by face; someone recognised is linked to the document.
  try {
    let faces = Array.isArray(alreadyFaces) ? alreadyFaces : null
    if (!faces) {
      const page = files.find((f) => f.kind === 'processed' && /^image\//.test(f.mime_type || '') && f.blob)
        || files.find((f) => (f.kind === 'original' || !f.kind) && /^image\//.test(f.mime_type || f.blob?.type || '') && f.blob)
      if (page) {
        const { findFaces, matchPerson } = await import('@/services/faces')
        faces = (await findFaces(page.blob)).slice(0, 6).map((f) => ({ ...f, person_id: matchPerson(f.d, people)?.person.id ?? null }))
      }
    }
    const fields = {}
    if (faces) {
      fields.faces = faces.map(({ box, crop, d, person_id }) => ({ box, crop, d, person_id: person_id ?? null }))
      const known = linkFaces ? faces.find((f) => f.person_id)?.person_id : null
      if (known) fields.person_id = known
    }
    // Where the photo was taken (see services/places).
    if (location?.lat !== undefined) fields.location = location
    if (Object.keys(fields).length) await api.patch(`${base}/metadata`, { fields })
  } catch { /* faces are optional */ }

  // 3. Chunk + embed
  say(onStatus, STATUS.SEARCHABLE, { step: 'embed' })
  try {
    const chunks = read.text ? chunkText(read.text, read.pages) : []
    if (chunks.length) {
      // The server makes the vectors (Workers AI), the same way for every document and query.
      await api.put(`${base}/chunks`, {
        version_id: versionId,
        chunks: chunks.map((c) => ({ chunk_number: c.chunk_number, page_number: c.page_number, section: c.section || undefined, content: c.content })),
      })
      result.embeddingsOk = true
    } else {
      result.embeddingsOk = result.textOk
    }
  } catch { /* search by name still works */ }

  result.ok = result.textOk || result.suggestionsOk || result.embeddingsOk
  say(onStatus, read.ok ? STATUS.READY : STATUS.NO_TEXT, { step: 'done', ...result })
  return result
}

/**
 * Fetch a document's current files and run the pipeline again ("Read text again").
 */
export async function reprocessDocument({ workspaceId, documentId, people, groups, workspaceKind, lang, onStatus } = {}) {
  const result = { ok: false, textOk: false, suggestionsOk: false, embeddingsOk: false }
  if (!workspaceId || !documentId) return result
  try {
    const res = await api.get(`/workspaces/${workspaceId}/documents/${documentId}`)
    const doc = res?.document
    if (!doc) return result
    const versionId = doc.current_version_id
    const all = (doc.files || []).filter((f) => !versionId || f.version_id === versionId)
    const wanted = all.filter((f) => f.kind === 'processed' || f.kind === 'original' || f.kind === 'pdf' || f.kind === 'thumbnail')
    const files = []
    for (const f of wanted) {
      try {
        const u = await api.get(`/workspaces/${workspaceId}/files/${f.id}/url`)
        const r = await fetch(u.url)
        if (!r.ok) continue
        const blob = await r.blob()
        files.push({ id: f.id, kind: f.kind, mime_type: f.mime_type || blob.type, page_number: f.page_number, blob })
      } catch { /* skip this file */ }
    }
    let list = people
    let glist = groups
    if (!list) {
      try { list = (await api.get(`/workspaces/${workspaceId}/people`))?.people || [] } catch { list = [] }
    }
    if (!glist) {
      try { glist = (await api.get(`/workspaces/${workspaceId}/groups`))?.groups || [] } catch { glist = [] }
    }
    return processDocument({ workspaceId, documentId, versionId, files, people: list, groups: glist, workspaceKind, lang, onStatus })
  } catch {
    return result
  }
}
