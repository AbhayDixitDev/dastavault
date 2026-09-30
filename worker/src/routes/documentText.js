import { Hono } from 'hono'
import { requireRole } from '../lib/workspace.js'
import { unwrap, notFound, badRequest } from '../lib/errors.js'
import { parseJson, documentTextPut, writtenCreate, writtenUpdate } from '../lib/validate.js'
import { activityFor } from '../lib/activity.js'
import { loadProfiles } from '../lib/profiles.js'
import { sanitizeHtml, htmlToText } from '../lib/sanitize.js'
import { DOC_FIELDS, VERSION_TEXT_FIELDS, FILE_FIELDS, loadDocument, loadVersions, assertCanView, attachSummaries, setDocumentLinks } from '../lib/docs.js'
import { storeFile, createVersion, finalizeVersion, versionFiles } from '../lib/uploadFiles.js'

/**
 * Text, timeline and written documents (contract section 2).
 * Mounted at /api/workspaces/:ws/documents (before routes/documents.js).
 */
const documentText = new Hono()

const HTML_TYPE = { mime: 'text/html', ext: 'html' }
const TEXT_MIMES = ['text/html', 'text/plain', 'text/markdown', 'text/csv']

// PUT /documents/:id/text
documentText.put('/:id/text', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, documentTextPut)

  const version = unwrap(
    await db.from('document_versions').select('id, version_number').eq('workspace_id', m.workspace_id).eq('document_id', doc.id).eq('id', body.version_id).maybeSingle(),
    'Load version',
  )
  if (!version) throw notFound('Version not found')

  const now = new Date().toISOString()
  const text = body.ocr_text ?? (body.pages.length ? body.pages.map((p) => p.text || '').join('\n\n') : null)
  unwrap(
    await db
      .from('document_versions')
      .update({
        ocr_text: text,
        ocr_language: body.ocr_language ?? null,
        ocr_confidence: body.ocr_confidence ?? null,
        ocr_status: body.ocr_status,
        updated_at: now,
      })
      .eq('id', version.id),
    'Save text',
  )

  if (body.pages.length) {
    const numbers = body.pages.map((p) => p.page_number)
    unwrap(
      await db.from('document_pages').upsert(
        body.pages.map((p) => ({
          workspace_id: m.workspace_id,
          document_id: doc.id,
          version_id: version.id,
          page_number: p.page_number,
          ocr_text: p.text ?? null,
          ocr_confidence: p.confidence ?? null,
          ocr_language: body.ocr_language ?? null,
          created_by: user.id,
          updated_at: now,
        })),
        { onConflict: 'version_id,page_number' },
      ),
      'Save pages',
    )
    // drop text-only pages that are no longer reported (pages backed by a file are kept)
    await db.from('document_pages').delete().eq('version_id', version.id).is('file_id', null).not('page_number', 'in', `(${numbers.join(',')})`)
    for (const p of body.pages) {
      if (p.width || p.height) {
        await db.from('document_files').update({ width: p.width ?? null, height: p.height ?? null }).eq('version_id', version.id).eq('page_number', p.page_number).eq('kind', 'original')
      }
    }
  }

  const pageCount = Math.max(body.pages.length, doc.page_count || 0) || null
  unwrap(await db.from('documents').update({ status: 'ready', page_count: pageCount, updated_at: now }).eq('id', doc.id), 'Mark document ready')
  await activityFor(c)('text_extracted', 'document', doc.id, { version_id: version.id, ocr_status: body.ocr_status, pages: body.pages.length, language: body.ocr_language ?? null }, `read the text of "${doc.name}"`)
  return c.json({ ok: true })
})

// GET /documents/:id/timeline
documentText.get('/:id/timeline', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  await assertCanView(db, m, doc)
  const rows = unwrap(
    await db
      .from('activity_logs')
      .select('id, actor_id, action, message, metadata, created_at')
      .eq('workspace_id', m.workspace_id)
      .eq('entity_type', 'document')
      .eq('entity_id', doc.id)
      .order('created_at', { ascending: false })
      .limit(200),
    'Load timeline',
  )
  const profiles = await loadProfiles(db, rows.map((r) => r.actor_id))
  const items = rows.map((r) => {
    const p = profiles.get(r.actor_id)
    return { id: r.id, action: r.action, message: r.message, actor: r.actor_id ? { id: r.actor_id, display_name: p?.display_name ?? null } : null, metadata: r.metadata, created_at: r.created_at }
  })
  return c.json({ items })
})

async function storeHtmlVersion(c, { document, version, html, name }) {
  const file = new File([html], `${name.replace(/[\\/:*?"<>|]/g, '')}.html`, { type: 'text/html' })
  return storeFile(c, { document, version, file, kind: 'original', pageNumber: 1, forceType: HTML_TYPE })
}

// POST /documents/written { name, content_html, content_text, document_type?, person_ids?, group_ids? }
documentText.post('/written', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const body = await parseJson(c, writtenCreate)
  const html = sanitizeHtml(body.content_html)
  const text = body.content_text?.trim() || htmlToText(html)
  const visibility = body.visibility || m.workspace.default_visibility || 'workspace'

  let document = unwrap(
    await db
      .from('documents')
      .insert({ workspace_id: m.workspace_id, name: body.name, original_filename: `${body.name}.html`.slice(0, 200), document_type: body.document_type || 'written', status: 'ready', visibility, page_count: 1, created_by: user.id })
      .select(DOC_FIELDS)
      .single(),
    'Create document',
  )
  let version
  try {
    version = await createVersion(db, {
      wsId: m.workspace_id,
      documentId: document.id,
      versionNumber: 1,
      source: 'written',
      actorId: user.id,
      extra: { ocr_text: text, ocr_status: 'manual', ocr_language: 'eng', ocr_confidence: 100 },
    })
    const stored = await storeHtmlVersion(c, { document, version, html, name: body.name })
    await db.from('document_versions').update({ hash: stored.sha256 }).eq('id', version.id)
    version.hash = stored.sha256
    await setDocumentLinks(db, m.workspace_id, document.id, { personIds: body.person_ids, groupIds: body.group_ids }, user.id)
    document = await finalizeVersion(db, m, document, version, { addedBytes: stored.size })
    await db.from('document_pages').upsert({ workspace_id: m.workspace_id, document_id: document.id, version_id: version.id, page_number: 1, file_id: stored.row.id, ocr_text: text, has_embedded_text: true, created_by: user.id }, { onConflict: 'version_id,page_number' })
  } catch (err) {
    await db.from('documents').delete().eq('id', document.id)
    throw err
  }
  await activityFor(c)('created', 'document', document.id, { name: document.name, written: true }, `wrote "${document.name}"`)
  await attachSummaries(db, m.workspace_id, [document])
  const fresh = unwrap(await db.from('document_versions').select(VERSION_TEXT_FIELDS).eq('id', version.id).single(), 'Load version')
  return c.json({ document, version: fresh, files: await versionFiles(db, version.id) }, 201)
})

// PUT /documents/:id/written { content_html, content_text, comment? } -> new version
documentText.put('/:id/written', requireRole('editor'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'))
  const body = await parseJson(c, writtenUpdate)
  const html = sanitizeHtml(body.content_html)
  const text = body.content_text?.trim() || htmlToText(html)

  const existing = await loadVersions(db, m.workspace_id, doc.id)
  const current = existing.find((v) => v.id === doc.current_version_id) || existing[0] || null
  const version = await createVersion(db, {
    wsId: m.workspace_id,
    documentId: doc.id,
    versionNumber: (existing[0]?.version_number || 0) + 1,
    previousVersionId: current?.id ?? null,
    source: 'edit',
    comment: body.comment ?? null,
    actorId: user.id,
    extra: { ocr_text: text, ocr_status: 'manual', ocr_language: 'eng', ocr_confidence: 100 },
  })
  let stored
  try {
    stored = await storeHtmlVersion(c, { document: doc, version, html, name: doc.name })
  } catch (err) {
    await db.from('document_versions').delete().eq('id', version.id)
    throw err
  }
  await db.from('document_versions').update({ hash: stored.sha256 }).eq('id', version.id)
  await db.from('document_pages').upsert({ workspace_id: m.workspace_id, document_id: doc.id, version_id: version.id, page_number: 1, file_id: stored.row.id, ocr_text: text, has_embedded_text: true, created_by: user.id }, { onConflict: 'version_id,page_number' })
  await finalizeVersion(db, m, doc, version, { addedBytes: stored.size, patch: { status: 'ready' } })
  await activityFor(c)('edited', 'document', doc.id, { version_id: version.id, version_number: version.version_number }, `edited "${doc.name}" (version ${version.version_number})`)
  const fresh = unwrap(await db.from('document_versions').select(VERSION_TEXT_FIELDS).eq('id', version.id).single(), 'Load version')
  return c.json({ version: fresh, files: await versionFiles(db, version.id) }, 201)
})

// GET /documents/:id/content -> { content_html, content_text, version_id }
documentText.get('/:id/content', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const doc = await loadDocument(db, m.workspace_id, c.req.param('id'), { includeDeleted: true })
  await assertCanView(db, m, doc)
  if (!doc.current_version_id) throw notFound('This document has no content yet')
  const version = unwrap(await db.from('document_versions').select(VERSION_TEXT_FIELDS).eq('id', doc.current_version_id).maybeSingle(), 'Load version')
  if (!version) throw notFound('Version not found')
  const files = unwrap(
    await db.from('document_files').select(FILE_FIELDS).eq('version_id', version.id).eq('kind', 'original').in('mime_type', TEXT_MIMES).order('page_number', { ascending: true, nullsFirst: false }).limit(1),
    'Load text file',
  )
  let contentHtml = null
  let fileText = null
  if (files[0]) {
    const obj = await c.env.DOCUMENTS_BUCKET.get(files[0].r2_object_key)
    if (obj) {
      const raw = await obj.text()
      if (files[0].mime_type === 'text/html') contentHtml = sanitizeHtml(raw)
      else fileText = raw
    }
  }
  if (contentHtml === null && fileText === null && !version.ocr_text) throw badRequest('This document has no text content')
  return c.json({ content_html: contentHtml, content_text: version.ocr_text ?? fileText ?? htmlToText(contentHtml), version_id: version.id })
})

export default documentText
