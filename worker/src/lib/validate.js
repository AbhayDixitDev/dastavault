import { z } from 'zod'
import { badRequest } from './errors.js'
import { ROLE_KEYS } from './permissions.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const uuid = () => z.string().regex(UUID_RE, 'Invalid id')
const shortText = (max = 200) => z.string().trim().min(1).max(max)
const optionalText = (max = 2000) => z.string().trim().max(max).nullable().optional()
const base64 = (max = 8192) => z.string().regex(/^[A-Za-z0-9+/_-]+={0,2}$/, 'Expected base64').max(max)

function formatIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
}

export function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) throw badRequest('Validation failed', formatIssues(result.error))
  return result.data
}

export async function parseJson(c, schema) {
  let body
  try {
    body = await c.req.json()
  } catch {
    throw badRequest('Invalid JSON body')
  }
  return parse(schema, body)
}

export function parseQuery(c, schema) {
  return parse(schema, c.req.query())
}

/* ---------- shared ---------- */

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(100).optional(),
})

export const roleKey = z.enum(ROLE_KEYS)
export const workspaceKind = z.enum(['family', 'company', 'school', 'organization', 'personal', 'custom'])
export const visibility = z.enum(['workspace', 'groups', 'people', 'private'])

/* ---------- profiles ---------- */

export const profilePatch = z
  .object({
    display_name: shortText(120).optional(),
    avatar_key: z.string().trim().max(500).nullable().optional(), // R2 object key
    preferred_language: z.string().trim().min(2).max(10).optional(),
    locale: z.string().trim().min(2).max(10).optional(), // alias for preferred_language
    large_text: z.boolean().optional(),
    features: z.record(z.string(), z.unknown()).optional(),
  ocr_languages: z.array(z.string().trim().min(2).max(10)).max(10).optional(),
  })
  .transform(({ locale, ...rest }) => (locale && !rest.preferred_language ? { ...rest, preferred_language: locale } : rest))

/* ---------- workspaces ---------- */

export const terminologyFields = z.object({
  workspace_label: shortText(60),
  member_label: shortText(60),
  member_label_plural: shortText(60),
  group_label: shortText(60),
  group_label_plural: shortText(60),
  subgroup_label: shortText(60),
  subgroup_label_plural: shortText(60),
  person_label: shortText(60),
  person_label_plural: shortText(60),
})

export const workspaceCreate = z.object({
  name: shortText(120),
  kind: workspaceKind,
  icon: z.string().trim().max(64).nullable().optional(),
  default_visibility: visibility.optional(),
  features: z.record(z.string(), z.unknown()).optional(),
  ocr_languages: z.array(z.string().trim().min(2).max(10)).max(10).optional(),
  terminology: terminologyFields.partial().optional(),
})

export const workspacePatch = z.object({
  name: shortText(120).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  default_visibility: visibility.optional(),
  features: z.record(z.string(), z.unknown()).optional(),
  ocr_languages: z.array(z.string().trim().min(2).max(10)).max(10).optional(),
})

/* ---------- members & invites ---------- */

export const memberRolePatch = z.object({ role_key: roleKey })
export const inviteCreate = z.object({
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  role_key: roleKey.exclude(['owner']),
})

/* ---------- groups ---------- */

export const groupCreate = z.object({
  name: shortText(120),
  description: optionalText(1000),
  color: z.string().trim().regex(/^#?[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  position: z.number().int().min(0).max(100000).optional(),
  parent_group_id: uuid().nullable().optional(),
})
export const groupPatch = groupCreate.partial()

/* ---------- people ---------- */

export const personCreate = z.object({
  display_name: shortText(120),
  first_name: optionalText(80),
  last_name: optionalText(80),
  relation_label: optionalText(60),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: optionalText(40),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  avatar_key: optionalText(500),
  user_id: uuid().nullable().optional(),
  notes: optionalText(5000),
  custom: z.record(z.string(), z.unknown()).optional(),
  group_ids: z.array(uuid()).max(50).optional(),
})
export const personPatch = personCreate.partial()

// Must match the check constraint on person_relationships.relation
export const RELATIONS = [
  'father', 'mother', 'parent', 'child', 'son', 'daughter', 'spouse',
  'brother', 'sister', 'grandparent', 'grandchild', 'guardian',
  'manager', 'reports_to', 'custom',
]
export const relationshipCreate = z.object({
  to_person_id: uuid(),
  relation: z.enum(RELATIONS),
  custom_label: optionalText(60),
})
export const personGroupLink = z.object({
  group_id: uuid(),
  role_in_group: optionalText(60),
})

/* ---------- documents ---------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
export const documentPatch = z.object({
  name: shortText(200).optional(),
  document_type: optionalText(60),
  visibility: visibility.optional(),
  summary: optionalText(5000),
  organisation: optionalText(200),
  document_number: optionalText(120),
  issue_date: isoDate,
  expiry_date: isoDate,
  is_favorite: z.boolean().optional(),
  is_pinned: z.boolean().optional(),
  // links (replace the full set when provided)
  person_ids: z.array(uuid()).max(50).optional(),
  group_ids: z.array(uuid()).max(50).optional(),
})

export const documentListQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  person_id: uuid().optional(),
  group_id: uuid().optional(),
  document_type: z.string().trim().max(60).optional(),
  favorite: z.enum(['1', 'true']).optional(),
  sort: z.enum(['created_at', 'updated_at', 'name', 'expiry_date']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- activity / notifications ---------- */

export const activityQuery = paginationQuery.extend({
  entity_type: z.string().trim().max(60).optional(),
  entity_id: uuid().optional(),
  action: z.string().trim().max(60).optional(),
})

export const notificationsQuery = paginationQuery.extend({
  unread: z.enum(['1', 'true', '0', 'false']).optional(),
  workspace_id: uuid().optional(),
})

/* ---------- vault (Chaabi) ---------- */

const kdfFields = {
  pin_salt: base64(256),
  pin_verifier_salt: base64(256),
  pin_verifier_hash: base64(256),
  kdf: z.enum(['PBKDF2-SHA256']).default('PBKDF2-SHA256'),
  kdf_iterations: z.number().int().min(100_000).max(5_000_000).default(600_000),
  pin_wrapped_key: base64(1024),
  wrap_iv: base64(64),
  pin_length: z.number().int().min(4).max(6).optional(),
}

export const vaultSetup = z.object({
  ...kdfFields,
  recovery_enabled: z.boolean().default(true),
  // Raw 256-bit vault key, base64. Only accepted here (and never stored or logged in clear).
  vault_key: base64(128).optional(),
})

export const vaultUnlock = z.object({ pin_verifier_hash: base64(256) })

export const vaultChangePin = z.object({
  current_pin_verifier_hash: base64(256),
  ...kdfFields,
})

export const vaultForgotVerify = z.object({ code: z.string().regex(/^\d{6}$/) })

export const vaultForgotComplete = z.object({
  reset_token: z.string().min(20).max(2000),
  ...kdfFields,
})

export const vaultItemCreate = z.object({
  title: shortText(200),
  website: optionalText(500),
  category: z.enum(['personal', 'banking', 'work', 'social', 'wifi', 'cards', 'other']).default('other'),
  is_favorite: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  strength: z.number().int().min(0).max(4).nullable().optional(),
  encrypted_blob: base64(64 * 1024),
  iv: base64(64),
})
export const vaultItemPatch = vaultItemCreate.partial().refine(
  (v) => (v.encrypted_blob === undefined) === (v.iv === undefined),
  { message: 'encrypted_blob and iv must be sent together' },
)
export const vaultItemsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(30).optional(),
  favorite: z.enum(['1', 'true']).optional(),
})

/* ---------- versions, text, written documents (contract section 2) ---------- */

const isoDateTime = z.string().trim().min(10).max(40).refine((s) => !Number.isNaN(Date.parse(s)), 'Expected an ISO date-time')
const confidence100 = z.number().min(0).max(100).nullable().optional()

export const versionRestore = z.object({ comment: optionalText(500) })

export const documentTextPut = z.object({
  version_id: uuid(),
  ocr_text: z.string().max(2_000_000).nullable().optional(),
  ocr_language: z.string().trim().max(20).nullable().optional(),
  ocr_confidence: confidence100,
  ocr_status: z.enum(['done', 'failed', 'skipped']).default('done'),
  pages: z
    .array(
      z.object({
        page_number: z.number().int().min(1).max(5000),
        text: z.string().max(500_000).nullable().optional(),
        confidence: confidence100,
        width: z.number().int().min(0).nullable().optional(),
        height: z.number().int().min(0).nullable().optional(),
      }),
    )
    .max(5000)
    .default([]),
})

const html = (max = 2_000_000) => z.string().max(max)
export const writtenCreate = z.object({
  name: shortText(200),
  content_html: html(),
  content_text: z.string().max(1_000_000).default(''),
  document_type: z.string().trim().max(60).default('written'),
  visibility: visibility.optional(),
  person_ids: z.array(uuid()).max(50).optional(),
  group_ids: z.array(uuid()).max(50).optional(),
})
export const writtenUpdate = z.object({
  content_html: html(),
  content_text: z.string().max(1_000_000).default(''),
  comment: optionalText(500),
})

/* ---------- details, suggestions, tags, duplicates, chunks (section 3) ---------- */

export const SUGGESTION_SOURCES = ['rules', 'ai', 'ocr']
export const suggestionsPut = z.object({
  version_id: uuid().optional(),
  suggestions: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        value: z.unknown(),
        confidence: z.number().min(0).max(1).default(0.5),
        source: z.enum(SUGGESTION_SOURCES).default('rules'),
      }),
    )
    .max(200),
})

export const metadataPatch = z.object({
  fields: z.record(z.string().trim().min(1).max(60), z.unknown()),
})

const tagColor = z.string().trim().regex(/^#?[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/).nullable().optional()
export const tagCreate = z.object({ name: shortText(60), color: tagColor })
export const tagPatch = tagCreate.partial()
export const documentTagsPut = z.object({
  tag_ids: z.array(uuid()).max(100).optional(),
  names: z.array(shortText(60)).max(100).optional(),
})

export const checkDuplicates = z.object({
  sha256: z.array(z.string().regex(/^[0-9a-fA-F]{64}$/)).max(50).optional(),
  perceptual_hash: z.string().trim().regex(/^[0-9a-fA-F]{8,64}$/).optional(),
  document_number: z.string().trim().min(3).max(120).optional(),
  text_sample: z.string().max(2000).optional(),
  exclude_document_id: uuid().optional(),
})

export const EMBEDDING_DIMENSION = 384
export const embeddingVector = z.array(z.number()).length(EMBEDDING_DIMENSION, `embedding must have ${EMBEDDING_DIMENSION} floats`)

export const chunksPut = z.object({
  version_id: uuid(),
  embedding_model: z.string().trim().min(1).max(120).default('Xenova/all-MiniLM-L6-v2'),
  embedding_version: z.string().trim().min(1).max(40).default('1'),
  dimension: z.literal(EMBEDDING_DIMENSION, { message: `dimension must be ${EMBEDDING_DIMENSION}` }),
  chunks: z
    .array(
      z.object({
        chunk_number: z.number().int().min(0),
        page_number: z.number().int().min(1).nullable().optional(),
        section: z.string().trim().max(200).nullable().optional(),
        content: z.string().min(1).max(4000),
        embedding: embeddingVector,
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(5000),
})
export const chunksQuery = z.object({ version_id: uuid().optional() })

/* ---------- search (section 4) ---------- */

const isoDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const searchFilters = z.object({
  person_id: uuid().optional(),
  group_id: uuid().optional(),
  document_type: z.string().trim().max(60).optional(),
  tag: z.string().trim().max(60).optional(),
  date_from: isoDateOnly.optional(),
  date_to: isoDateOnly.optional(),
  expiry_from: isoDateOnly.optional(),
  expiry_to: isoDateOnly.optional(),
  uploaded_by: uuid().optional(),
  file_type: z.enum(['image', 'pdf', 'text']).optional(),
})
const searchLimit = z.coerce.number().int().min(1).max(100).default(40)
export const searchQuery = searchFilters.extend({
  q: z.string().trim().max(300).default(''),
  limit: searchLimit,
})
export const hybridSearchBody = z.object({
  q: z.string().trim().max(300).default(''),
  embedding: embeddingVector.optional(),
  filters: searchFilters.optional(),
  limit: searchLimit,
})
export const imageSearchBody = z.object({
  perceptual_hash: z.string().trim().regex(/^[0-9a-fA-F]{8,64}$/).optional(),
  text_sample: z.string().max(2000).optional(),
  embedding: embeddingVector.optional(),
  limit: searchLimit,
})
export const savedSearchCreate = z.object({
  name: shortText(120),
  query: z.string().trim().max(300).default(''),
  filters: z.record(z.string(), z.unknown()).default({}),
})

/* ---------- albums, reminders, shares (section 5) ---------- */

export const ALBUM_KINDS = ['manual', 'smart', 'person', 'type', 'group', 'event']
export const SMART_RULE_FIELDS = ['person_id', 'group_id', 'document_type', 'tag', 'created_after', 'created_before', 'expiry_within_days', 'organisation', 'text']
export const albumRules = z.object({
  all: z
    .array(
      z.object({
        field: z.enum(SMART_RULE_FIELDS),
        op: z.enum(['eq', 'in', 'contains', 'gte', 'lte']).default('eq'),
        value: z.unknown(),
      }),
    )
    .max(20)
    .default([]),
})
export const albumCreate = z.object({
  name: shortText(120),
  kind: z.enum(ALBUM_KINDS).default('manual'),
  description: optionalText(1000),
  rules: albumRules.optional(),
})
export const albumPatch = z.object({
  name: shortText(120).optional(),
  description: optionalText(1000),
  rules: albumRules.optional(),
  cover_file_id: uuid().nullable().optional(),
})
export const albumItemsAdd = z.object({ document_ids: z.array(uuid()).min(1).max(200) })

export const REMINDER_STATUSES = ['pending', 'sent', 'done', 'snoozed']
export const REMINDER_CHANNELS = ['app', 'email', 'both']
export const reminderCreate = z.object({
  document_id: uuid(),
  title: shortText(200),
  remind_at: isoDateTime,
  field: optionalText(60),
  channel: z.enum(REMINDER_CHANNELS).default('both'),
})
export const reminderPatch = z.object({
  title: shortText(200).optional(),
  remind_at: isoDateTime.optional(),
  status: z.enum(REMINDER_STATUSES).optional(),
  channel: z.enum(REMINDER_CHANNELS).optional(),
})
export const remindersQuery = z.object({
  upcoming_days: z.coerce.number().int().min(1).max(3650).default(30),
  document_id: uuid().optional(),
})
export const expiringQuery = z.object({ days: z.coerce.number().int().min(1).max(3650).default(30) })

export const shareCreate = z.object({
  document_id: uuid(),
  kind: z.enum(['link', 'member', 'group']).default('link'),
  target_id: uuid().optional(),
  expires_in_hours: z.number().min(1).max(24 * 365).default(72),
  password: z.string().min(4).max(200).optional(),
  allow_download: z.boolean().default(false),
})
export const sharesQuery = z.object({ document_id: uuid().optional() })

/* ---------- AI keys and RAG (section 6) ---------- */

export const AI_PROVIDERS = ['openai', 'gemini', 'anthropic', 'groq', 'local', 'custom']
export const aiKeyCreate = z.object({
  provider: z.enum(AI_PROVIDERS),
  api_key: z.string().trim().min(1).max(1000),
  label: optionalText(80),
  model: optionalText(120),
  base_url: z.string().trim().url().max(500).nullable().optional(),
  is_default: z.boolean().default(false),
})
export const ragAsk = z.object({
  question: z.string().trim().min(1).max(2000),
  embedding: embeddingVector.optional(),
  document_id: uuid().optional(),
  key_id: uuid().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).max(20).default([]),
})
export const ragExtract = z.object({
  document_id: uuid(),
  version_id: uuid(),
  key_id: uuid().optional(),
})

/* ---------- notes (section 7) ---------- */

export const NOTE_LINK_TYPES = ['person', 'group', 'document', 'album']
const noteLink = z.object({ entity_type: z.enum(NOTE_LINK_TYPES), entity_id: uuid() })
export const noteCreate = z.object({
  title: z.string().trim().max(300).default(''),
  content_html: z.string().max(1_000_000).default(''),
  content_text: z.string().max(500_000).default(''),
  color: optionalText(30),
  is_pinned: z.boolean().default(false),
  is_private: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  links: z.array(noteLink).max(50).optional(),
  encrypted_blob: base64(512 * 1024).nullable().optional(),
  iv: base64(64).nullable().optional(),
  template: optionalText(30),
})
export const notePatch = noteCreate.partial().extend({ updated_at: isoDateTime.optional() })
export const notesQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  pinned: z.enum(['1', 'true']).optional(),
})
