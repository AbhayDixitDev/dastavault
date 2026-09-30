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

export const profilePatch = z.object({
  display_name: shortText(120).optional(),
  avatar_url: z.string().url().max(2000).nullable().optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  large_text: z.boolean().optional(),
})

/* ---------- workspaces ---------- */

export const terminologyFields = z.object({
  workspace_label: shortText(60),
  member_label: shortText(60),
  member_label_plural: shortText(60),
  group_label: shortText(60),
  group_label_plural: shortText(60),
  subgroup_label: shortText(60).nullable(),
  subgroup_label_plural: shortText(60).nullable(),
  person_label: shortText(60),
  person_label_plural: shortText(60),
})

export const workspaceCreate = z.object({
  name: shortText(120),
  kind: workspaceKind,
  icon: z.string().trim().max(64).nullable().optional(),
  default_visibility: visibility.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  terminology: terminologyFields.partial().optional(),
})

export const workspacePatch = z.object({
  name: shortText(120).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  default_visibility: visibility.optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
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

export const RELATIONS = [
  'father', 'mother', 'parent', 'child', 'son', 'daughter', 'spouse',
  'brother', 'sister', 'sibling', 'grandparent', 'grandchild', 'guardian', 'ward',
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

export const documentPatch = z.object({
  title: shortText(200).optional(),
  description: optionalText(5000),
  doc_type: optionalText(60),
  visibility: visibility.optional(),
  person_id: uuid().nullable().optional(),
})

export const documentListQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
  person_id: uuid().optional(),
  sort: z.enum(['created_at', 'updated_at', 'title']).default('created_at'),
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
