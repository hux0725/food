import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Db } from '../db/index.js'
import { notFound } from '../errors.js'

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  neighborhood: z.string().trim().max(100).optional(),
  cuisine: z.string().trim().max(100).optional(),
  maxPrice: z.coerce.number().positive().max(10000).optional(),
})

const idParams = z.object({ id: z.string().min(1).max(100) })

export const placeRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/places', async (request) => {
    const places = db.listPlaces(querySchema.parse(request.query))
    return { places, count: places.length }
  })

  app.get('/places/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const place = db.getPlace(id)
    if (!place) throw notFound(`Place "${id}"`)
    return { place }
  })
}
