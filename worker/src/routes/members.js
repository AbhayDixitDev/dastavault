import { Hono } from 'hono'
import { requireAuth } from '../lib/auth.js'
import { requireRole } from '../lib/workspace.js'
import { unwrap, forbidden, notFound, badRequest, conflict } from '../lib/errors.js'
import { parseJson, memberRolePatch, inviteCreate } from '../lib/validate.js'
import { attachProfiles } from '../lib/profiles.js'
import { activityFor, logActivity } from '../lib/activity.js'
import { sendInviteEmail } from '../lib/email.js'
import { randomToken, isUuid } from '../lib/ids.js'
import { ensureProfile } from './me.js'

const MEMBER_FIELDS = 'id, workspace_id, user_id, role_key, person_id, invited_by, joined_at'
const INVITE_FIELDS = 'id, workspace_id, email, role_key, token, status, invited_by, expires_at, accepted_at, accepted_by, created_at'
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/* =====================================================================
 * Workspace-scoped: mounted under /api/workspaces/:ws (auth + membership already applied)
 * ===================================================================== */
export const membersRoutes = new Hono()

async function loadMember(db, wsId, memberId) {
  if (!isUuid(memberId)) throw badRequest('Invalid member id')
  const row = unwrap(await db.from('workspace_members').select(MEMBER_FIELDS).eq('workspace_id', wsId).eq('id', memberId).maybeSingle(), 'Load member')
  if (!row) throw notFound('Member not found')
  return row
}

async function ownerCount(db, wsId) {
  const res = await db.from('workspace_members').select('id', { count: 'exact', head: true }).eq('workspace_id', wsId).eq('role_key', 'owner')
  return res.count ?? 0
}

// GET /members
membersRoutes.get('/members', async (c) => {
  const db = c.get('db')
  const m = c.get('membership')
  const rows = unwrap(
    await db.from('workspace_members').select(MEMBER_FIELDS).eq('workspace_id', m.workspace_id).order('joined_at', { ascending: true }),
    'List members',
  )
  await attachProfiles(db, rows, 'user_id', 'profile')
  return c.json({ members: rows })
})

// PATCH /members/:memberId  { role_key }  (admin+)
membersRoutes.patch('/members/:memberId', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const me = c.get('membership')
  const { role_key } = await parseJson(c, memberRolePatch)
  const target = await loadMember(db, me.workspace_id, c.req.param('memberId'))

  // Only an owner may grant or revoke the owner role (ownership transfer).
  if ((role_key === 'owner' || target.role_key === 'owner') && me.role_key !== 'owner') {
    throw forbidden('Only an owner can change owner roles')
  }
  if (target.role_key === 'owner' && role_key !== 'owner' && (await ownerCount(db, me.workspace_id)) <= 1) {
    throw conflict('Cannot demote the last owner. Make someone else an owner first.')
  }

  const member = unwrap(
    await db.from('workspace_members').update({ role_key }).eq('id', target.id).eq('workspace_id', me.workspace_id).select(MEMBER_FIELDS).single(),
    'Update member role',
  )
  await attachProfiles(db, [member], 'user_id', 'profile')
  await activityFor(c)('member.role_changed', 'member', member.id, { user_id: member.user_id, from: target.role_key, to: role_key })
  return c.json({ member })
})

// DELETE /members/:memberId  (admin+; owners cannot be removed)
membersRoutes.delete('/members/:memberId', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const me = c.get('membership')
  const target = await loadMember(db, me.workspace_id, c.req.param('memberId'))
  if (target.role_key === 'owner') throw forbidden('Owners cannot be removed. Transfer ownership first.')
  if (target.role_key === 'admin' && me.role_key !== 'owner' && target.user_id !== me.user_id) {
    throw forbidden('Only an owner can remove another admin')
  }
  unwrap(await db.from('workspace_members').delete().eq('id', target.id).eq('workspace_id', me.workspace_id), 'Remove member')
  await activityFor(c)('member.removed', 'member', target.id, { user_id: target.user_id, role_key: target.role_key })
  return c.json({ ok: true })
})

// POST /invites  { email, role_key }  (admin+)
membersRoutes.post('/invites', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const me = c.get('membership')
  const user = c.get('user')
  const body = await parseJson(c, inviteCreate)

  // Already a member?
  const existingProfile = unwrap(await db.from('profiles').select('id').ilike('email', body.email).maybeSingle(), 'Lookup profile')
  if (existingProfile) {
    const existingMember = unwrap(
      await db.from('workspace_members').select('id').eq('workspace_id', me.workspace_id).eq('user_id', existingProfile.id).maybeSingle(),
      'Lookup membership',
    )
    if (existingMember) throw conflict('This person is already a member')
  }

  // One pending invite per email: revoke any previous one.
  await db.from('workspace_invites').update({ status: 'revoked' }).eq('workspace_id', me.workspace_id).ilike('email', body.email).eq('status', 'pending')

  const invite = unwrap(
    await db
      .from('workspace_invites')
      .insert({
        workspace_id: me.workspace_id,
        email: body.email,
        role_key: body.role_key,
        token: randomToken(32),
        status: 'pending',
        invited_by: user.id,
        expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      })
      .select(INVITE_FIELDS)
      .single(),
    'Create invite',
  )

  const inviter = await ensureProfile(db, user)
  const link = `${(c.env.APP_URL || '').replace(/\/$/, '')}/invite/${invite.token}`
  const emailResult = await sendInviteEmail(c.env, {
    to: invite.email,
    inviterName: inviter.display_name || inviter.email || 'Someone',
    workspaceName: me.workspace.name,
    roleKey: invite.role_key,
    link,
    expiresAt: invite.expires_at,
  })
  await activityFor(c)('invite.sent', 'invite', invite.id, { email: invite.email, role_key: invite.role_key, email_sent: emailResult.sent })
  return c.json({ invite: { ...invite, link, email_sent: emailResult.sent } }, 201)
})

// GET /invites  (admin+) pending invites
membersRoutes.get('/invites', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const me = c.get('membership')
  const rows = unwrap(
    await db.from('workspace_invites').select(INVITE_FIELDS).eq('workspace_id', me.workspace_id).eq('status', 'pending').order('created_at', { ascending: false }),
    'List invites',
  )
  await attachProfiles(db, rows, 'invited_by', 'inviter')
  const now = Date.now()
  for (const r of rows) r.expired = new Date(r.expires_at).getTime() < now
  return c.json({ invites: rows })
})

// DELETE /invites/:inviteId  (admin+) - marks the invite revoked
membersRoutes.delete('/invites/:inviteId', requireRole('admin'), async (c) => {
  const db = c.get('db')
  const me = c.get('membership')
  const inviteId = c.req.param('inviteId')
  if (!isUuid(inviteId)) throw badRequest('Invalid invite id')
  const rows = unwrap(
    await db.from('workspace_invites').update({ status: 'revoked' }).eq('workspace_id', me.workspace_id).eq('id', inviteId).eq('status', 'pending').select('id, email'),
    'Revoke invite',
  )
  if (!rows.length) throw notFound('Pending invite not found')
  await activityFor(c)('invite.revoked', 'invite', inviteId, { email: rows[0].email })
  return c.json({ ok: true })
})

/* =====================================================================
 * Token routes: mounted under /api/invites (auth, no membership needed)
 * ===================================================================== */
export const inviteRoutes = new Hono()
inviteRoutes.use('*', requireAuth())

async function loadInviteByToken(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw badRequest('Invalid invite token')
  const invite = unwrap(
    await db.from('workspace_invites').select(`${INVITE_FIELDS}, workspace:workspaces!workspace_id(id, name, kind, icon, deleted_at)`).eq('token', token).maybeSingle(),
    'Load invite',
  )
  if (!invite || !invite.workspace || invite.workspace.deleted_at) throw notFound('Invite not found')
  return invite
}

function publicInvite(invite) {
  return {
    id: invite.id,
    email: invite.email,
    role_key: invite.role_key,
    workspace: { id: invite.workspace.id, name: invite.workspace.name, kind: invite.workspace.kind, icon: invite.workspace.icon },
    status: invite.status,
    expires_at: invite.expires_at,
    accepted_at: invite.accepted_at,
    expired: new Date(invite.expires_at).getTime() < Date.now(),
  }
}

// GET /api/invites/:token
inviteRoutes.get('/:token', async (c) => {
  const invite = await loadInviteByToken(c.get('db'), c.req.param('token'))
  return c.json({ invite: publicInvite(invite) })
})

// POST /api/invites/:token/accept
inviteRoutes.post('/:token/accept', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const invite = await loadInviteByToken(db, c.req.param('token'))

  // Implemented here (not via the accept_workspace_invite() SQL function) because auth.jwt() is null under the service role.
  if (invite.status === 'accepted' || invite.accepted_at) throw conflict('This invite has already been used')
  if (invite.status !== 'pending') throw badRequest(`This invite is ${invite.status}`)
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await db.from('workspace_invites').update({ status: 'expired' }).eq('id', invite.id)
    throw badRequest('This invite has expired')
  }
  if (!user.email || user.email !== invite.email.toLowerCase()) {
    throw forbidden(`This invite was sent to ${invite.email}. Sign in with that email to accept it.`)
  }

  await ensureProfile(db, user)
  const existing = unwrap(
    await db.from('workspace_members').select('id').eq('workspace_id', invite.workspace_id).eq('user_id', user.id).maybeSingle(),
    'Lookup membership',
  )
  if (!existing) {
    unwrap(
      await db.from('workspace_members').insert({ workspace_id: invite.workspace_id, user_id: user.id, role_key: invite.role_key, invited_by: invite.invited_by }),
      'Create membership',
    )
  }
  unwrap(
    await db.from('workspace_invites').update({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by: user.id }).eq('id', invite.id),
    'Mark invite accepted',
  )
  await logActivity(db, {
    workspaceId: invite.workspace_id,
    actorId: user.id,
    action: 'invite.accepted',
    entityType: 'invite',
    entityId: invite.id,
    details: { role_key: invite.role_key },
  })
  return c.json({ workspace_id: invite.workspace_id })
})
