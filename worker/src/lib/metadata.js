import { unwrap, badRequest } from './errors.js'
import { DOC_FIELDS } from './docs.js'
import { activityFor } from './activity.js'

/**
 * Confirmed metadata (document_metadata) and suggestions
 * (document_metadata_suggestions). Contract section 3.
 */
export const WELL_KNOWN_KEYS = [
  'document_type', 'person_name', 'organisation', 'document_number', 'issue_date', 'expiry_date',
  'invoice_number', 'amount', 'currency', 'vendor', 'policy_number', 'registration_number', 'email', 'phone',
  'address', 'category', 'keywords', 'summary', 'suggested_name', 'person_id', 'group_id',
]

/** Keys that mirror 1:1 to a documents column. */
const COLUMN_KEYS = new Set(['document_type', 'organisation', 'document_number', 'issue_date', 'expiry_date', 'summary'])
const DATE_KEYS = new Set(['issue_date', 'expiry_date'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** API source names <-> DB check constraint values ('rule'). */
export const toDbSource = (s) => (s === 'rules' ? 'rule' : s)
export const fromDbSource = (s) => (s === 'rule' ? 'rules' : s)

export const SUGGESTION_FIELDS = 'id, workspace_id, document_id, version_id, key, value_text, value_number, value_date, value_json, confidence, source, status, reviewed_by, reviewed_at, created_by, created_at'
export const METADATA_FIELDS = 'id, document_id, key, value_text, value_number, value_date, value_json, source, confirmed_by, confirmed_at, updated_at'

/** Splits a JSON value into the typed value_* columns. */
export function valueColumns(value) {
  const out = { value_text: null, value_number: null, value_date: null, value_json: null }
  if (value === null || value === undefined) return out
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.value_number = value
    out.value_text = String(value)
  } else if (typeof value === 'string') {
    out.value_text = value
    if (DATE_RE.test(value) && !Number.isNaN(Date.parse(value))) out.value_date = value
  } else if (typeof value === 'boolean') {
    out.value_text = String(value)
    out.value_json = value
  } else {
    out.value_json = value
    out.value_text = Array.isArray(value) ? value.map(String).join(', ') : null
  }
  return out
}

export function rowValue(row) {
  if (row.value_json !== null && row.value_json !== undefined) return row.value_json
  if (row.value_number !== null && row.value_number !== undefined) return Number(row.value_number)
  if (row.value_text !== null && row.value_text !== undefined) return row.value_text
  if (row.value_date !== null && row.value_date !== undefined) return row.value_date
  return null
}

export function publicSuggestion(row) {
  return {
    id: row.id,
    key: row.key,
    value: rowValue(row),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    source: fromDbSource(row.source),
    accepted_at: row.status === 'accepted' ? row.reviewed_at : null,
    status: row.status,
    version_id: row.version_id,
    created_at: row.created_at,
  }
}

export async function loadSuggestions(db, docId) {
  const rows = unwrap(
    await db.from('document_metadata_suggestions').select(SUGGESTION_FIELDS).eq('document_id', docId).order('created_at'),
    'Load suggestions',
  )
  return rows.map(publicSuggestion)
}

/** `{ key: value }` of the confirmed metadata rows. */
export async function loadMetadata(db, docId) {
  const rows = unwrap(await db.from('document_metadata').select(METADATA_FIELDS).eq('document_id', docId).order('key'), 'Load metadata')
  const out = {}
  for (const r of rows) out[r.key] = rowValue(r)
  return out
}

function asText(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * Upserts confirmed metadata rows for `fields` (null/'' deletes a key) and
 * mirrors well-known keys to the document (columns, person/group links, name).
 * Returns { document, metadata }.
 */
export async function applyMetadata(c, doc, fields, { source = 'manual' } = {}) {
  const db = c.get('db')
  const m = c.get('membership')
  const user = c.get('user')
  const now = new Date().toISOString()
  const columnPatch = {}
  const upserts = []
  const deletes = []
  const linkPeople = []
  const linkGroups = []
  let rename = null

  for (const [key, raw] of Object.entries(fields)) {
    const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
    if (empty) {
      deletes.push(key)
      if (COLUMN_KEYS.has(key)) columnPatch[key] = null
      continue
    }
    upserts.push({
      workspace_id: m.workspace_id,
      document_id: doc.id,
      key,
      ...valueColumns(raw),
      source,
      confirmed_by: user.id,
      confirmed_at: now,
      created_by: user.id,
      updated_at: now,
    })

    const text = asText(raw)
    if (COLUMN_KEYS.has(key)) {
      if (DATE_KEYS.has(key)) {
        if (text && DATE_RE.test(text) && !Number.isNaN(Date.parse(text))) columnPatch[key] = text
      } else if (text) {
        columnPatch[key] = key === 'summary' ? text.slice(0, 5000) : text.slice(0, 200)
      }
    } else if (key === 'person_id' && text) {
      linkPeople.push(text)
    } else if (key === 'group_id' && text) {
      linkGroups.push(text)
    } else if (key === 'person_name' && text) {
      const person = unwrap(
        await db.from('people').select('id').eq('workspace_id', m.workspace_id).is('deleted_at', null).ilike('display_name', text.replace(/[%_,]/g, '')).limit(1).maybeSingle(),
        'Find person by name',
      )
      if (person) linkPeople.push(person.id)
    } else if (key === 'suggested_name' && text) {
      rename = text.slice(0, 200)
    }
  }

  if (deletes.length) unwrap(await db.from('document_metadata').delete().eq('document_id', doc.id).in('key', deletes), 'Delete metadata')
  if (upserts.length) unwrap(await db.from('document_metadata').upsert(upserts, { onConflict: 'document_id,key' }), 'Save metadata')

  for (const personId of linkPeople) {
    const person = unwrap(await db.from('people').select('id').eq('workspace_id', m.workspace_id).eq('id', personId).is('deleted_at', null).maybeSingle(), 'Verify person')
    if (!person) throw badRequest('person_id does not exist in this workspace')
    await db
      .from('document_people')
      .upsert({ workspace_id: m.workspace_id, document_id: doc.id, person_id: personId, link_type: 'owner', created_by: user.id }, { onConflict: 'document_id,person_id', ignoreDuplicates: true })
  }
  for (const groupId of linkGroups) {
    const group = unwrap(await db.from('groups').select('id').eq('workspace_id', m.workspace_id).eq('id', groupId).maybeSingle(), 'Verify group')
    if (!group) throw badRequest('group_id does not exist in this workspace')
    await db
      .from('document_groups')
      .upsert({ workspace_id: m.workspace_id, document_id: doc.id, group_id: groupId, created_by: user.id }, { onConflict: 'document_id,group_id', ignoreDuplicates: true })
  }

  if (rename && rename !== doc.name) {
    columnPatch.name = rename
    columnPatch.previous_names = [...new Set([...(doc.previous_names || []), doc.name])].slice(-20)
  }

  let document = doc
  if (Object.keys(columnPatch).length) {
    document = unwrap(
      await db.from('documents').update({ ...columnPatch, updated_at: now }).eq('id', doc.id).eq('workspace_id', m.workspace_id).select(DOC_FIELDS).single(),
      'Mirror metadata to document',
    )
  }
  await activityFor(c)('details_edited', 'document', doc.id, { keys: Object.keys(fields), source }, `updated details of "${document.name}"`)
  return { document, metadata: await loadMetadata(db, doc.id) }
}
