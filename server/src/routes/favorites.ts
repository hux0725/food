import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Db } from '../db/index.js'
import { notFound } from '../errors.js'
import { currentUserId } from '../user.js'

const params = z.object({ placeId: z.string().min(1).max(100) })

export const favoriteRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/favorites', async (request) => ({ favorites: db.listFavorites(currentUserId(request)) }))

  /** Idempotent: saving twice keeps one favorite. */
  app.put('/favorites/:placeId', async (request) => {
    const { placeId } = params.parse(request.params)
    if (!db.getPlace(placeId)) throw notFound(`Place "${placeId}"`)
    return { favorite: db.addFavorite(currentUserId(request), placeId) }
  })

  /** Idempotent: removing a place that is not saved still succeeds. */
  app.delete('/favorites/:placeId', async (request, reply) => {
    const { placeId } = params.parse(request.params)
    if (!db.getPlace(placeId)) throw notFound(`Place "${placeId}"`)
    db.removeFavorite(currentUserId(request), placeId)
    return reply.status(204).send()
  })
}
