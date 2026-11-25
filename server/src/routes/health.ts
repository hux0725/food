import type { FastifyPluginAsync } from 'fastify'
import type { HealthResponse } from '../../../shared/types.js'
import type { LlmProvider } from '../assistant/provider.js'
import type { Db } from '../db/index.js'
import { EXPECTED_PLACE_COUNT } from '../db/seed.js'
import { APP_VERSION } from '../version.js'

export const healthRoutes: FastifyPluginAsync<{ db: Db; provider: LlmProvider }> = async (app, { db, provider }) => {
  app.get('/health', async (_request, reply): Promise<HealthResponse> => {
    const dbOk = db.ping()
    let places: number
    try {
      places = dbOk ? db.countPlaces() : 0
    } catch {
      places = 0
    }
    const healthy = dbOk && places === EXPECTED_PLACE_COUNT
    reply.header('Cache-Control', 'no-store')
    if (!healthy) reply.status(503)
    return {
      status: healthy ? 'ok' : 'degraded',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      places,
      db: dbOk,
      llmConfigured: provider.ready,
      time: new Date().toISOString(),
    }
  })
}
