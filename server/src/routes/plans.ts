import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { isValidDateString, isValidTimeString, seattleToday } from '../../../shared/dates.js'
import { ForeignKeyViolation, UniqueViolation, type Db } from '../db/index.js'
import { AppError, notFound } from '../errors.js'
import { currentUserId } from '../user.js'

const date = z.string().refine(isValidDateString, 'must be a real date in YYYY-MM-DD form')
const time = z.string().refine(isValidTimeString, 'must be a time in HH:MM (24-hour) form')

const createBody = z.object({ placeId: z.string().min(1).max(100), date, time }).strict()
const updateBody = z
  .object({ date: date.optional(), time: time.optional() })
  .strict()
  .refine((body) => body.date !== undefined || body.time !== undefined, 'send a date, a time, or both')
const idParams = z.object({ id: z.string().min(1).max(100) })

/** Plans are for today or later, in Seattle. Existing past plans can still be read and deleted. */
function assertNotPast(value: string, now: () => Date) {
  if (value < seattleToday(now())) throw new AppError('PAST_DATE', 400, 'Pick today or a later date.')
}

const DUPLICATE = 'That restaurant is already planned for that day.'

export const planRoutes: FastifyPluginAsync<{ db: Db; now?: () => Date }> = async (app, { db, now = () => new Date() }) => {
  app.get('/plans', async (request) => ({ plans: db.listPlans(currentUserId(request)) }))

  app.post('/plans', async (request, reply) => {
    const body = createBody.parse(request.body)
    assertNotPast(body.date, now)
    if (!db.getPlace(body.placeId)) throw notFound(`Place "${body.placeId}"`)
    try {
      const plan = db.createPlan(currentUserId(request), body)
      return reply.status(201).send({ plan })
    } catch (error) {
      if (error instanceof UniqueViolation) throw new AppError('CONFLICT', 409, DUPLICATE)
      if (error instanceof ForeignKeyViolation) throw notFound(`Place "${body.placeId}"`)
      throw error
    }
  })

  app.patch('/plans/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const body = updateBody.parse(request.body)
    if (body.date) assertNotPast(body.date, now)
    try {
      const plan = db.updatePlan(currentUserId(request), id, body)
      if (!plan) throw notFound('Plan')
      return { plan }
    } catch (error) {
      if (error instanceof UniqueViolation) throw new AppError('CONFLICT', 409, DUPLICATE)
      throw error
    }
  })

  app.delete('/plans/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    if (!db.deletePlan(currentUserId(request), id)) throw notFound('Plan')
    return reply.status(204).send()
  })
}
