import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { requireWorkspace } from '../lib/workspace.js'
import { unwrap, forbidden } from '../lib/errors.js'
import { parseJson, workspaceCreate, workspacePatch, terminologyFields } from '../lib/validate.js'
import { buildTerminology } from '../lib/terminology.js'
import { logActivity, activityFor } from '../lib/activity.js'
import { ensureProfile } from './me.js'

const workspaces = new Hono()
workspaces.use('*', requireAuth())

const WS_FIELDS = 'id, name, kind, icon, default_visibility, features, ocr_languages, storage_bytes, owner_id, created_by, created_at, updated_at, deleted_at'
const TERM_FIELDS =
  'workspace_id, workspace_label, member_label, member_label_plural, group_label, group_label_plural, subgroup_label, subgroup_label_plural, person_label, person_label_plural'

function firstOrNull(v) {
  return Array.isArray(v) ? v[0] ?? null : v ?? null
}

async function loadTerminology(db, wsId) {
  return unwrap(await db.from('workspace_terminology').select(TERM_FIELDS).eq('workspace_id', wsId).maybeSingle(), 'Load terminology')
}

// GET /api/workspaces - all workspaces the caller belongs to
workspaces.get('/', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const rows = unwrap(
    await db
      .from('workspace_members')
      .select(`role_key, joined_at, workspace:workspaces!workspace_id!inner(${WS_FIELDS}, terminology:workspace_terminology(${TERM_FIELDS}))`)
      .eq('user_id', user.id)
      .is('workspace.deleted_at', null)
      .order('joined_at', { ascending: true }),
    'List workspaces',
  )
  const list = rows
    .filter((r) => r.workspace)
    .map((r) => ({ ...r.workspace, role_key: r.role_key, terminology: firstOrNull(r.workspace.terminology) }))
  return c.json({ workspaces: list })
})

// POST /api/workspaces - create workspace (+ terminology + owner membership)
// The DB has an AFTER INSERT trigger on workspaces that inserts the owner membership
// and the kind's terminology template. owner_id defaults to auth.uid(), which is NULL
// under the service role, so it is set explicitly here.
workspaces.post('/', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const body = await parseJson(c, workspaceCreate)
  await ensureProfile(db, user)

  const workspace = unwrap(
    await db
      .from('workspaces')
      .insert({
        name: body.name,
        kind: body.kind,
        icon: body.icon ?? null,
        default_visibility: body.default_visibility ?? 'workspace',
        ...(body.features ? { features: body.features } : {}),
        ...(body.ocr_languages ? { ocr_languages: body.ocr_languages } : {}),
        owner_id: user.id,
        created_by: user.id,
      })
      .select(WS_FIELDS)
      .single(),
    'Create workspace',
  )

  try {
    // Terminology: the trigger seeds the template; only overwrite when the client sent overrides.
    const hasOverrides = body.terminology && Object.values(body.terminology).some((v) => v !== undefined)
    let terminology
    if (hasOverrides) {
      terminology = unwrap(
        await db
          .from('workspace_terminology')
          .upsert({ workspace_id: workspace.id, ...buildTerminology(body.kind, body.terminology) }, { onConflict: 'workspace_id' })
          .select(TERM_FIELDS)
          .single(),
        'Save terminology',
      )
    } else {
      terminology = await loadTerminology(db, workspace.id)
      if (!terminology) {
        terminology = unwrap(
          await db.from('workspace_terminology').upsert({ workspace_id: workspace.id, ...buildTerminology(body.kind) }, { onConflict: 'workspace_id' }).select(TERM_FIELDS).single(),
          'Create terminology',
        )
      }
    }

    // Membership: normally created by the trigger; insert only if it is missing.
    const membership = unwrap(
      await db.from('workspace_members').select('id, role_key').eq('workspace_id', workspace.id).eq('user_id', user.id).maybeSingle(),
      'Load owner membership',
    )
    if (!membership) {
      unwrap(await db.from('workspace_members').insert({ workspace_id: workspace.id, user_id: user.id, role_key: 'owner', invited_by: null }), 'Create owner membership')
    } else if (membership.role_key !== 'owner') {
      unwrap(await db.from('workspace_members').update({ role_key: 'owner' }).eq('id', membership.id), 'Promote owner membership')
    }

    await logActivity(db, {
      workspaceId: workspace.id,
      actorId: user.id,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: workspace.id,
      details: { name: workspace.name, kind: workspace.kind },
    })
    return c.json({ workspace: { ...workspace, role_key: 'owner', terminology } }, 201)
  } catch (err) {
    // Best-effort rollback (no multi-statement transactions over PostgREST).
    await db.from('workspace_members').delete().eq('workspace_id', workspace.id)
    await db.from('workspace_terminology').delete().eq('workspace_id', workspace.id)
    await db.from('workspaces').delete().eq('id', workspace.id)
    throw err
  }
})

// GET /api/workspaces/:ws
workspaces.get('/:ws', requireWorkspace(), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const [workspace, terminology, countRes] = await Promise.all([
    db.from('workspaces').select(WS_FIELDS).eq('id', m.workspace_id).single(),
    loadTerminology(db, m.workspace_id),
    db.from('workspace_members').select('id', { count: 'exact', head: true }).eq('workspace_id', m.workspace_id),
  ])
  return c.json({
    workspace: { ...unwrap(workspace, 'Load workspace'), role_key: m.role_key, terminology, member_count: countRes.count ?? 0 },
  })
})

// PATCH /api/workspaces/:ws (admin+)
workspaces.patch('/:ws', requireWorkspace('admin'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const patch = await parseJson(c, workspacePatch)
  const workspace = unwrap(
    await db.from('workspaces').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', m.workspace_id).select(WS_FIELDS).single(),
    'Update workspace',
  )
  await activityFor(c)('workspace.updated', 'workspace', m.workspace_id, { fields: Object.keys(patch) })
  const terminology = await loadTerminology(db, m.workspace_id)
  return c.json({ workspace: { ...workspace, role_key: m.role_key, terminology } })
})

// DELETE /api/workspaces/:ws (owner only, soft delete - 30 day purge is a scheduled job later)
workspaces.delete('/:ws', requireWorkspace('owner'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  if (m.role_key !== 'owner') throw forbidden('Only the owner can delete a workspace')
  unwrap(
    await db.from('workspaces').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', m.workspace_id),
    'Delete workspace',
  )
  await activityFor(c)('workspace.deleted', 'workspace', m.workspace_id)
  return c.json({ ok: true })
})

// GET /api/workspaces/:ws/terminology
workspaces.get('/:ws/terminology', requireWorkspace(), async (c) => {
  const terminology = await loadTerminology(c.get('db'), c.get('membership').workspace_id)
  return c.json({ terminology })
})

// PUT /api/workspaces/:ws/terminology (admin+)
workspaces.put('/:ws/terminology', requireWorkspace('admin'), async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const body = await parseJson(c, terminologyFields.partial())
  const current = (await loadTerminology(db, m.workspace_id)) || buildTerminology(m.workspace.kind)
  const next = { ...current, ...body, workspace_id: m.workspace_id }
  const terminology = unwrap(
    await db.from('workspace_terminology').upsert(next, { onConflict: 'workspace_id' }).select(TERM_FIELDS).single(),
    'Save terminology',
  )
  await activityFor(c)('workspace.terminology_updated', 'workspace', m.workspace_id, { fields: Object.keys(body) })
  return c.json({ terminology })
})

export default workspaces
