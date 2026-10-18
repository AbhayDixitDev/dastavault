import { Hono } from 'hono'
import { z } from 'zod'
import { requireRole } from '../lib/workspace.js'
import { parseJson } from '../lib/validate.js'
import { HttpError } from '../lib/errors.js'

/**
 * Reading a page photo with a vision model, handwriting included (the app's
 * on-device reader only reads print). Mounted at /api/workspaces/:ws/read.
 *
 *   POST / { images: [base64 JPEG, max 2], document_types: [keys] }
 *     -> { text, details: { title, summary, person_name, ... }, model }
 *
 * Runs on Cloudflare Workers AI (the AI binding, no key needed). The photo is
 * not stored.
 */
const readPage = new Hono()

// Free-tier models, best first. Llama 4 Scout read a made-up form with
// handwritten name, job title and date correctly in ~9 s (~70 neurons a page).
const MODELS = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/mistralai/mistral-small-3.1-24b-instruct']
const MAX_IMAGE_CHARS = 3_000_000 // base64, ~2.2 MB

const body = z.object({
  images: z.array(z.string().min(100).max(MAX_IMAGE_CHARS)).min(1).max(2),
  document_types: z.array(z.string().max(40)).max(60).optional(),
})

const DETAIL_KEYS = ['title', 'summary', 'document_type', 'person_name', 'organisation', 'document_number', 'issue_date', 'expiry_date', 'amount', 'currency', 'designation', 'department', 'address', 'phone', 'email']

function prompt(types) {
  return [
    'Read this document photo completely, handwriting included (names, dates and values written by hand on lines or in boxes).',
    'Reply with JSON only, no other words:',
    '{',
    '"text": every word on the page as written, line by line, with handwritten values in place,',
    '"title": the heading of the document,',
    '"summary": one or two sentences: what this document is, about whom, signed or issued by whom and when,',
    `"document_type": one of ${(types?.length ? types : ['other']).join(', ')},`,
    '"person_name": full name of the person the document belongs to or who signed it,',
    '"organisation": who issued it, if named,',
    '"document_number": ID, certificate, policy, invoice or account number, if any,',
    '"issue_date": date written on it as YYYY-MM-DD,',
    '"expiry_date": YYYY-MM-DD if it has one,',
    '"amount": total amount as a number, if any, "currency": like INR,',
    '"designation": job title, if any, "department": if any, "address", "phone", "email": if any',
    '}',
    'Use null for anything not on the page. Do not guess.',
  ].join('\n')
}

/** The JSON object in a reply, also when it is wrapped in ``` fences. */
export function parseReply(reply) {
  const s = String(reply || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

export function cleanDetails(raw, types) {
  const details = {}
  for (const key of DETAIL_KEYS) {
    let v = raw?.[key]
    if (v === null || v === undefined) continue
    if (typeof v === 'number' && key === 'amount') { details.amount = v; continue }
    v = String(v).trim()
    if (!v || /^(null|none|n\/a|not (?:found|available|present|mentioned))$/i.test(v)) continue
    if ((key === 'issue_date' || key === 'expiry_date') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue
    if (key === 'document_type') {
      v = v.toLowerCase().replace(/[\s-]+/g, '_')
      if (types?.length && !types.includes(v)) continue
    }
    if (key === 'amount') {
      const n = Number(v.replace(/[^0-9.]/g, ''))
      if (!Number.isFinite(n) || n <= 0) continue
      details.amount = n
      continue
    }
    details[key] = v.slice(0, key === 'summary' ? 600 : 200)
  }
  return details
}

readPage.post('/', requireRole('editor'), async (c) => {
  if (!c.env.AI) throw new HttpError(503, 'Reading handwriting is not set up on this server.', 'ai_unavailable')
  const { images, document_types: types } = await parseJson(c, body)
  const content = [{ type: 'text', text: prompt(types) }, ...images.map((b64) => ({ type: 'image_url', image_url: { url: b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}` } }))]
  let lastError = null
  for (const model of MODELS) {
    try {
      const out = await c.env.AI.run(model, { messages: [{ role: 'user', content }], max_tokens: 2500, temperature: 0 })
      const reply = out?.response ?? out?.choices?.[0]?.message?.content
      const parsed = parseReply(typeof reply === 'string' ? reply : JSON.stringify(reply))
      if (!parsed) { lastError = new Error('unreadable reply'); continue }
      return c.json({ text: String(parsed.text || '').slice(0, 20_000), details: cleanDetails(parsed, types), model })
    } catch (err) {
      lastError = err
      console.warn('[read] model failed:', model, err?.message)
    }
  }
  throw new HttpError(502, `Could not read the page: ${lastError?.message || 'no reply'}`, 'ai_read_failed')
})

export default readPage
