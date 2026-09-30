/**
 * AI provider factory (contract section 6).
 *   getProvider({ provider, apiKey, model, baseUrl })
 *     -> { name, model, chat({ system, messages, maxTokens }) -> { text, model, usage } }
 * openai.js also serves groq / local / custom through base_url.
 */
import { openaiProvider } from './openai.js'
import { geminiProvider } from './gemini.js'
import { anthropicProvider } from './anthropic.js'
import { HttpError } from '../errors.js'

export const NOT_FOUND_SENTENCE = 'I could not find that information in your documents.'

export function getProvider({ provider, apiKey, model, baseUrl }) {
  switch (provider) {
    case 'openai':
    case 'groq':
    case 'local':
    case 'custom':
      return openaiProvider({ provider, apiKey, model, baseUrl })
    case 'gemini':
      return geminiProvider({ apiKey, model, baseUrl })
    case 'anthropic':
      return anthropicProvider({ apiKey, model, baseUrl })
    default:
      throw new HttpError(400, `Unknown AI provider "${provider}"`, 'ai_provider_unknown')
  }
}
