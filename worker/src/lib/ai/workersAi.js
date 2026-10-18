/**
 * Free answers without a key: the Workers AI binding (env.AI), same chat()
 * shape as the other providers. Used when the user has not added a key.
 */
const MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast']

export function workersAiProvider(env) {
  return {
    name: 'workers-ai',
    model: MODELS[0],
    async chat({ system, messages, maxTokens = 800 }) {
      let lastError
      for (const model of MODELS) {
        try {
          const out = await env.AI.run(model, { messages: [{ role: 'system', content: system }, ...messages], max_tokens: maxTokens, temperature: 0.2 })
          const text = typeof out?.response === 'string' ? out.response : typeof out === 'string' ? out : ''
          if (text.trim()) return { text, model, usage: out?.usage ?? null }
        } catch (err) {
          lastError = err
          console.warn(`[ai] ${model} failed:`, err?.message || err)
        }
      }
      throw lastError || new Error('The free AI gave no answer; try again')
    },
  }
}
