/**
 * OpenAI-compatible chat completions (OpenAI, Groq, local servers such as
 * Ollama / LM Studio, and any "custom" base URL). fetch only, no SDK.
 */
import { HttpError } from '../errors.js'

const DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
  local: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
  custom: { baseUrl: null, model: null },
}

export function openaiProvider({ provider = 'openai', apiKey, model, baseUrl }) {
  const d = DEFAULTS[provider] || DEFAULTS.custom
  const base = String(baseUrl || d.baseUrl || '').replace(/\/$/, '')
  if (!base) throw new HttpError(400, `base_url is required for the "${provider}" provider`, 'ai_base_url_required')
  const usedModel = model || d.model
  if (!usedModel) throw new HttpError(400, `model is required for the "${provider}" provider`, 'ai_model_required')

  return {
    name: provider,
    model: usedModel,
    async chat({ system, messages, maxTokens = 1024, temperature = 0.2 }) {
      const body = {
        model: usedModel,
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.map((m) => ({ role: m.role, content: m.content }))],
        max_tokens: maxTokens,
        temperature,
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error?.message || `${provider} responded ${res.status}`
        throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, `AI provider error: ${msg}`, 'ai_provider_error', { status: res.status })
      }
      const text = data?.choices?.[0]?.message?.content ?? ''
      return { text: typeof text === 'string' ? text : JSON.stringify(text), model: data?.model || usedModel, usage: data?.usage || null }
    },
  }
}
