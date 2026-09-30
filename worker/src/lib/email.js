/**
 * Brevo transactional email. All senders are no-ops (with a console.warn) when
 * BREVO_API_KEY is not configured, so local development works without email.
 */
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

export async function sendEmail(env, { to, subject, html, text, tags = [] }) {
  if (!env.BREVO_API_KEY) {
    console.warn(`[email] BREVO_API_KEY missing - not sending "${subject}" to ${to}`)
    return { sent: false, reason: 'not_configured' }
  }
  const sender = {
    email: env.BREVO_SENDER_EMAIL || 'no-reply@example.com',
    name: env.BREVO_SENDER_NAME || 'DastaVault',
  }
  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      tags,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[email] Brevo responded ${res.status}: ${body.slice(0, 300)}`)
    return { sent: false, reason: `brevo_${res.status}` }
  }
  const data = await res.json().catch(() => ({}))
  return { sent: true, messageId: data.messageId }
}

export function sendInviteEmail(env, { to, inviterName, workspaceName, roleKey, link, expiresAt }) {
  const subject = `${inviterName} invited you to ${workspaceName} on DastaVault`
  const text = [
    `${inviterName} has invited you to join "${workspaceName}" on DastaVault as ${roleKey}.`,
    '',
    `Accept the invitation: ${link}`,
    '',
    `This link expires on ${new Date(expiresAt).toUTCString()}.`,
    'If you were not expecting this, you can ignore this email.',
  ].join('\n')
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a">
      <h2 style="margin:0 0 12px">You're invited to ${escapeHtml(workspaceName)}</h2>
      <p>${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(workspaceName)}</strong> on DastaVault as <strong>${escapeHtml(roleKey)}</strong>.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Accept invitation</a></p>
      <p style="font-size:14px;color:#555">Or copy this link: ${escapeHtml(link)}</p>
      <p style="font-size:13px;color:#777">This link expires on ${escapeHtml(new Date(expiresAt).toUTCString())}. If you were not expecting this, you can ignore this email.</p>
    </div>`
  return sendEmail(env, { to, subject, html, text, tags: ['invite'] })
}

export function sendOtpEmail(env, { to, code, minutes = 10 }) {
  const subject = 'Your DastaVault Chaabi reset code'
  const text = [
    `Your one-time code to reset your Chaabi PIN is: ${code}`,
    '',
    `It is valid for ${minutes} minutes and can be used once.`,
    'If you did not ask to reset your PIN, ignore this email; your passwords stay locked.',
  ].join('\n')
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a">
      <h2 style="margin:0 0 12px">Reset your Chaabi PIN</h2>
      <p>Your one-time code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:8px 0 16px">${escapeHtml(code)}</p>
      <p style="font-size:14px;color:#555">It is valid for ${minutes} minutes and can be used once.</p>
      <p style="font-size:13px;color:#777">If you did not ask to reset your PIN, ignore this email. Your passwords stay locked.</p>
    </div>`
  return sendEmail(env, { to, subject, html, text, tags: ['vault-otp'] })
}
