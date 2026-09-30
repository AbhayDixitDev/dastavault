import { createServiceClient } from './supabase.js'
import { loadProfiles } from './profiles.js'
import { sendReminderEmail } from './email.js'

/**
 * Scheduled handler: sends due reminders (status pending/scheduled/snoozed and
 * remind_at <= now). Recipients are the reminder's user_id when set, otherwise
 * every workspace member with role editor or above plus the creator.
 * Channels: in_app -> notifications rows, email -> Brevo. Marks status='sent'.
 */
const EDITOR_ROLES = ['editor', 'admin', 'owner']

export async function processDueReminders(env) {
  const db = createServiceClient(env)
  const now = new Date().toISOString()
  const due = await db.from('reminders').select('id, workspace_id, document_id, title, due_date, remind_at, channels, user_id, created_by').in('status', ['pending', 'scheduled', 'snoozed']).lte('remind_at', now).order('remind_at').limit(100)
  if (due.error) return console.error('[cron] load reminders failed:', due.error.message)
  const rows = due.data || []
  if (!rows.length) return console.log('[cron] no reminders due')

  const wsIds = [...new Set(rows.map((r) => r.workspace_id))]
  const docIds = [...new Set(rows.map((r) => r.document_id).filter(Boolean))]
  const [wsRes, memberRes, docRes] = await Promise.all([
    db.from('workspaces').select('id, name').in('id', wsIds),
    db.from('workspace_members').select('workspace_id, user_id, role_key').in('workspace_id', wsIds),
    docIds.length ? db.from('documents').select('id, name, deleted_at').in('id', docIds) : Promise.resolve({ data: [] }),
  ])
  const workspaces = new Map((wsRes.data || []).map((w) => [w.id, w]))
  const docs = new Map((docRes.data || []).map((d) => [d.id, d]))
  const membersByWs = new Map()
  for (const mem of memberRes.data || []) {
    if (!membersByWs.has(mem.workspace_id)) membersByWs.set(mem.workspace_id, [])
    membersByWs.get(mem.workspace_id).push(mem)
  }
  const allUserIds = new Set(rows.flatMap((r) => [r.user_id, r.created_by]).filter(Boolean))
  for (const list of membersByWs.values()) for (const mem of list) allUserIds.add(mem.user_id)
  const profiles = await loadProfiles(db, [...allUserIds])
  const appUrl = String(env.APP_URL || '').replace(/\/$/, '')

  let sent = 0
  for (const r of rows) {
    const doc = r.document_id ? docs.get(r.document_id) : null
    if (r.document_id && (!doc || doc.deleted_at)) {
      await db.from('reminders').update({ status: 'done', updated_at: now }).eq('id', r.id)
      continue
    }
    const recipients = new Set()
    if (r.user_id) recipients.add(r.user_id)
    else {
      for (const mem of membersByWs.get(r.workspace_id) || []) if (EDITOR_ROLES.includes(mem.role_key)) recipients.add(mem.user_id)
      if (r.created_by) recipients.add(r.created_by)
    }
    const channels = Array.isArray(r.channels) ? r.channels : ['in_app']
    const link = doc && appUrl ? `${appUrl}/documents/${doc.id}` : appUrl || null
    const body = doc ? `${doc.name}${r.due_date ? ` - due ${r.due_date}` : ''}` : r.due_date ? `Due ${r.due_date}` : null

    if (channels.includes('in_app') || channels.includes('app')) {
      const notes = [...recipients].map((user_id) => ({
        workspace_id: r.workspace_id,
        user_id,
        type: 'reminder',
        title: r.title,
        body,
        data: { document_id: r.document_id, reminder_id: r.id, url: link },
      }))
      if (notes.length) {
        const ins = await db.from('notifications').insert(notes)
        if (ins.error) console.warn('[cron] notifications insert failed:', ins.error.message)
      }
    }
    if (channels.includes('email')) {
      for (const userId of recipients) {
        const p = profiles.get(userId)
        if (!p?.email) continue
        try {
          await sendReminderEmail(env, { to: p.email, title: r.title, documentName: doc?.name ?? null, workspaceName: workspaces.get(r.workspace_id)?.name ?? null, dueDate: r.due_date, link })
        } catch (err) {
          console.warn('[cron] reminder email failed:', err?.message || err)
        }
      }
    }
    const upd = await db.from('reminders').update({ status: 'sent', sent_at: now, updated_at: now }).eq('id', r.id)
    if (upd.error) console.warn('[cron] reminder update failed:', upd.error.message)
    else sent++
  }
  console.log(`[cron] reminders processed: ${rows.length}, sent: ${sent}`)
}
