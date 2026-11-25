import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { CUISINES, NEIGHBORHOODS } from '../../../src/data/places.js'
import { mealMomentFor, seattleDateTime, seattleHour } from '../../../shared/dates.js'
import type { AssistantResponse } from '../../../shared/types.js'
import type { AssistantService } from '../assistant/service.js'
import { AppError } from '../errors.js'
import type { RateLimiter } from '../rateLimit.js'

const knownNeighborhood = (value: string | null | undefined) =>
  NEIGHBORHOODS.find((name) => name.toLowerCase() === value?.trim().toLowerCase()) ?? null
const knownCuisine = (value: string | null | undefined) => CUISINES.find((name) => name.toLowerCase() === value?.trim().toLowerCase()) ?? null

const bodySchema = z.object({
  // Longer messages are truncated to 500 characters, not rejected.
  message: z.string().max(10_000),
  location: z.string().max(200).optional(),
  neighborhood: z.string().max(100).nullable().optional(),
  cuisine: z.string().max(100).nullable().optional(),
  mode: z.enum(['walk', 'bike', 'car']).default('walk'),
  budget: z.number().positive().max(100_000).nullable().optional(),
  mealMoment: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
  seattleTime: z.string().max(40).optional(),
  userLocation: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).nullable().optional(),
})

export type AssistantRouteOptions = {
  service: AssistantService
  /** Hard ceiling per client; above it the endpoint answers 429 with a friendly message. */
  floodLimiter: RateLimiter
  production: boolean
}

export const assistantRoutes: FastifyPluginAsync<AssistantRouteOptions> = async (app, { service, floodLimiter, production }) => {
  app.post('/assistant', async (request): Promise<AssistantResponse> => {
    if (!floodLimiter.allow(request.ip)) {
      throw new AppError('RATE_LIMITED', 429, 'Lots of questions at once. Give it a few seconds and ask again.')
    }
    const body = bodySchema.parse(request.body)
    const { response, meta } = await service.answer(
      {
        message: body.message,
        mode: body.mode,
        neighborhood: knownNeighborhood(body.neighborhood) ?? knownNeighborhood(body.location),
        cuisine: knownCuisine(body.cuisine),
        budget: body.budget ?? null,
        mealMoment: body.mealMoment ?? mealMomentFor(seattleHour()),
        seattleTime: seattleDateTime(),
      },
      request.ip,
    )
    request.log.info(
      {
        assistant: {
          ...meta,
          messageChars: body.message.length,
          // Full user messages stay out of production logs.
          ...(production ? {} : { message: body.message.slice(0, 200) }),
        },
      },
      'assistant answered',
    )
    return response
  })
}
