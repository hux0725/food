import { LlmError, type LlmProvider, type LlmRequest, type LlmResult } from '../assistant/provider.js'
import type { LlmKeyStore } from './keyStore.js'

export const GOOGLE_API_URL = 'https://generativelanguage.googleapis.com'

/**
 * Gemini counts "thinking" tokens against maxOutputTokens, and some models think by default.
 * The answer itself is short, so this headroom stops a thinking model from running out before it writes it.
 * It is a ceiling, not a cost: only tokens actually generated are billed.
 */
const THINKING_HEADROOM_TOKENS = 1024

export type KeyCheck = { ok: true } | { ok: false; reason: 'rejected' | 'unreachable' }

/**
 * Google reports a wrong or expired key as HTTP 400 (API_KEY_INVALID), not 401, so the body has to be read.
 * 401 and 403 mean the key is unusable here too (revoked, restricted, or reported as leaked).
 * Only call this when the body is not needed afterwards.
 */
async function keyIsRejected(response: Response): Promise<boolean> {
  if (response.status === 401 || response.status === 403) return true
  if (response.status !== 400) return false
  try {
    return /API_KEY_INVALID|API key not valid|API key expired/i.test(await response.text())
  } catch {
    return false
  }
}

/**
 * Asks Google whether a key is valid by listing one model. This uses no tokens.
 * The key goes in a header, never in the URL.
 */
export async function verifyGoogleKey(apiKey: string, timeoutMs = 8000, baseUrl = GOOGLE_API_URL): Promise<KeyCheck> {
  try {
    const response = await fetch(`${baseUrl}/v1beta/models?pageSize=1`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    })
    // 429 means Google recognized the key and is only rate limiting it.
    if (response.ok || response.status === 429) return { ok: true }
    if (await keyIsRejected(response)) return { ok: false, reason: 'rejected' }
    return { ok: false, reason: 'unreachable' }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

type GenerateContentResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

/** Gemini generateContent API. The key is read from the key store on every call and only ever sent to Google. */
export function googleProvider(keyStore: LlmKeyStore, model: string | undefined, baseUrl = GOOGLE_API_URL): LlmProvider {
  return {
    name: 'google',
    get ready() {
      return keyStore.configured && Boolean(model)
    },
    async complete({ system, user, maxTokens, signal }: LlmRequest): Promise<LlmResult> {
      const key = keyStore.key
      if (!key || !model) throw new LlmError('not_configured')
      // Accept both "gemini-2.5-flash-lite" and the "models/gemini-2.5-flash-lite" form Google's docs sometimes show.
      const modelName = model.replace(/^models\//, '')
      let response: Response
      try {
        response = await fetch(`${baseUrl}/v1beta/models/${encodeURIComponent(modelName)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens + THINKING_HEADROOM_TOKENS, responseMimeType: 'application/json' },
          }),
          signal,
        })
      } catch (error) {
        if (signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))) throw new LlmError('timeout')
        throw new LlmError('network')
      }
      if (await keyIsRejected(response)) {
        keyStore.markRejected()
        throw new LlmError('auth', response.status)
      }
      if (response.status === 429) throw new LlmError('rate_limited', 429)
      if (response.status >= 500) throw new LlmError('server', response.status)
      if (!response.ok) throw new LlmError('bad_response', response.status)
      let body: GenerateContentResponse
      try {
        body = (await response.json()) as GenerateContentResponse
      } catch {
        throw new LlmError(signal.aborted ? 'timeout' : 'bad_response', response.status)
      }
      // Thought parts are the model's reasoning, not the answer.
      const parts = body.candidates?.[0]?.content?.parts ?? []
      const text = parts.filter((part) => !part.thought).map((part) => part.text ?? '').join('')
      // No text means the prompt or answer was blocked, or the model ran out of tokens. Either way: fall back.
      if (!text) throw new LlmError('bad_response', response.status)
      const usage = body.usageMetadata
      return { text, inputTokens: usage?.promptTokenCount ?? 0, outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0) }
    },
  }
}
