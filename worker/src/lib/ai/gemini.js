/** Google Gemini (generateContent REST API). fetch only, no SDK. */
import { HttpError } from '../errors.js'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = 'gemini-2.0-flash'

export function geminiProvider({ apiKey, model, baseUrl }) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '')
  const usedModel = model || DEFAULT_MODEL
  if (!apiKey) throw new HttpError(400, 'api_key is required for Gemini', 'ai_key_required')

  return {
    name: 'gemini',
    model: usedModel,
    async chat({ system, messages, maxTokens = 1024, temperature = 0.2 }) {
      const body = {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      }
      const res = await fetch(`${base}/models/${encodeURIComponent(usedModel)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data?.error?.message || `Gemini responded ${res.status}`
        throw new HttpError(res.status === 400 || res.status === 401 || res.status === 403 ? 400 : 502, `AI provider error: ${msg}`, 'ai_provider_error', { status: res.status })
      }
      const parts = data?.candidates?.[0]?.content?.parts || []
      const text = parts.map((p) => p.text || '').join('')
      const u = data?.usageMetadata
      return {
        text,
        model: usedModel,
        usage: u ? { prompt_tokens: u.promptTokenCount, completion_tokens: u.candidatesTokenCount, total_tokens: u.totalTokenCount } : null,
      }
    },
  }
}
