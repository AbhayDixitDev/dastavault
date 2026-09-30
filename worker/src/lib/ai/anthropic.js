/** Anthropic Messages API (raw HTTP, no SDK). */
import { HttpError } from '../errors.js'

const DEFAULT_BASE = 'https://api.anthropic.com'
const DEFAULT_MODEL = 'claude-opus-5-5'

export function anthropicProvider({ apiKey, model, baseUrl }) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '')
  const usedModel = model || DEFAULT_MODEL
  if (!apiKey) throw new HttpError(400, 'api_key is required for Anthropic', 'ai_key_required')

  return {
    name: 'anthropic',
    model: usedModel,
    async chat({ system, messages, maxTokens = 1024 }) {
      // Messages must alternate and start with a user turn.
      const turns = []
      for (const m of messages) {
        const role = m.role === 'assistant' ? 'assistant' : 'user'
        if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += `\n\n${m.content}`
        else turns.push({ role, content: m.content })
      }
      if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', content: '(no question)' })

      const body = { model: usedModel, max_tokens: maxTokens, ...(system ? { system } : {}), messages: turns }
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error?.message || `Anthropic responded ${res.status}`
        throw new HttpError(res.status === 401 || res.status === 403 || res.status === 400 ? 400 : 502, `AI provider error: ${msg}`, 'ai_provider_error', { status: res.status })
      }
      if (data?.stop_reason === 'refusal') {
        return { text: '', model: data?.model || usedModel, usage: data?.usage || null, refused: true }
      }
      const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
      const u = data?.usage
      return {
        text,
        model: data?.model || usedModel,
        usage: u ? { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0) } : null,
      }
    },
  }
}
