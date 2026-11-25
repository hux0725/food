import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { AiStatus, SaveAiKeyResponse } from '../../../shared/types.js'
import type { LlmProvider } from '../assistant/provider.js'
import type { Env } from '../env.js'
import { AppError, notFound } from '../errors.js'
import { isPlausibleGoogleKey } from '../../../shared/llm-key.js'
import type { KeyCheck } from '../llm/google.js'
import type { LlmKeyStore } from '../llm/keyStore.js'
import { RateLimiter } from '../rateLimit.js'

const saveKeyBody = z.object({ apiKey: z.string().trim().min(1, 'is empty').max(400, 'is too long') })

export type AiRoutesOptions = {
  env: Env
  keyStore: LlmKeyStore
  provider: LlmProvider
  verifyKey: (apiKey: string) => Promise<KeyCheck>
}

export const aiRoutes: FastifyPluginAsync<AiRoutesOptions> = async (app, { env, keyStore, provider, verifyKey }) => {
  const attempts = new RateLimiter(10, 10 * 60 * 1000)

  app.get('/ai/status', async (): Promise<AiStatus> => ({
    configured: provider.ready,
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL ?? null,
    keyPromptEnabled: env.AI_KEY_PROMPT,
    demoDebug: env.DEMO_DEBUG,
  }))

  // Development convenience only. In production the key comes from the host's environment settings.
  // TODO(auth): if this is ever enabled on a public URL, restrict it to an admin.
  app.post('/ai/key', async (request): Promise<SaveAiKeyResponse> => {
    if (!env.AI_KEY_PROMPT) throw notFound('This endpoint')
    if (!attempts.allow(request.ip)) {
      throw new AppError('RATE_LIMITED', 429, 'Too many key attempts. Wait a few minutes and try again.')
    }

    // Once a key is set, nobody can replace it from the browser. Change it in server/.env instead.
    if (keyStore.configured) {
      throw new AppError('AI_KEY_ALREADY_SET', 409, 'An API key has already been added. AI is on.')
    }

    const { apiKey } = saveKeyBody.parse(request.body)
    if (!isPlausibleGoogleKey(apiKey)) {
      throw new AppError('AI_KEY_FORMAT', 400, 'That does not look like a Google (Gemini) API key. Create one in Google AI Studio, and copy all of it.')
    }

    const check = await verifyKey(apiKey)
    if (!check.ok && check.reason === 'rejected') {
      throw new AppError('AI_KEY_REJECTED', 400, 'Google did not accept that key. Check that you copied all of it, or create a new one.')
    }

    const { persisted } = keyStore.save(apiKey)
    request.log.info({ verified: check.ok, persisted }, 'LLM API key added')
    return { configured: true, verified: check.ok, persisted }
  })
}
