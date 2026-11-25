import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Db, UniqueViolation } from '../../server/src/db/index'
import { seedPlaces } from '../../server/src/db/seed'
import { TODAY, makeApp, tempDir, type TestApp } from './helpers'

const open: TestApp[] = []
afterEach(async () => {
  while (open.length) await open.pop()!.app.close()
})
async function start(...args: Parameters<typeof makeApp>) {
  const created = await makeApp(...args)
  open.push(created)
  return created.app
}

const createPlan = (app: TestApp['app'], payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/plans', payload })

describe('plans', () => {
  it('creates, lists, edits and deletes a plan', async () => {
    const app = await start()
    const created = await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:30' })
    expect(created.statusCode).toBe(201)
    const { plan } = created.json()
    expect(plan).toMatchObject({ placeId: 'wolf', date: '2026-12-03', time: '19:30' })

    const listed = (await app.inject('/api/plans')).json().plans
    expect(listed).toHaveLength(1)

    const edited = await app.inject({ method: 'PATCH', url: `/api/plans/${plan.id}`, payload: { time: '18:00' } })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().plan).toMatchObject({ date: '2026-12-03', time: '18:00' })

    expect((await app.inject({ method: 'DELETE', url: `/api/plans/${plan.id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/api/plans/${plan.id}` })).statusCode).toBe(404)
    expect((await app.inject('/api/plans')).json().plans).toHaveLength(0)
  })

  it('validates input with clear 400s', async () => {
    const app = await start()
    const cases: Array<Record<string, unknown>> = [
      {},
      { placeId: 'wolf', date: '2027-02-29', time: '19:00' },
      { placeId: 'wolf', date: '12/03/2026', time: '19:00' },
      { placeId: 'wolf', date: '2026-12-03', time: '7pm' },
      { placeId: 'wolf', date: '2026-12-03', time: '24:00' },
      { placeId: 'wolf', date: '2026-12-03', time: '19:00', extra: true },
      { placeId: '', date: '2026-12-03', time: '19:00' },
    ]
    for (const payload of cases) {
      const res = await createPlan(app, payload)
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(res.json().error.code).toBe('BAD_REQUEST')
      expect(res.json().error.message).toMatch(/^Invalid /)
    }
    const plan = (await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:00' })).json().plan
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${plan.id}`, payload: {} })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${plan.id}`, payload: { placeId: 'other' } })).statusCode).toBe(400)
  })

  it('allows today and the leap day, refuses past dates (Seattle calendar)', async () => {
    const app = await start()
    expect((await createPlan(app, { placeId: 'wolf', date: TODAY, time: '19:00' })).statusCode).toBe(201)
    expect((await createPlan(app, { placeId: 'wolf', date: '2028-02-29', time: '19:00' })).statusCode).toBe(201)
    const past = await createPlan(app, { placeId: 'wolf', date: '2026-11-23', time: '19:00' })
    expect(past.statusCode).toBe(400)
    expect(past.json().error).toMatchObject({ code: 'PAST_DATE', message: 'Pick today or a later date.' })
  })

  it('404s unknown places and unknown plans', async () => {
    const app = await start()
    expect((await createPlan(app, { placeId: 'made-up', date: '2026-12-03', time: '19:00' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: '/api/plans/nope', payload: { time: '18:00' } })).statusCode).toBe(404)
  })

  it('409s a second plan for the same place and day, on create and on edit', async () => {
    const app = await start()
    await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '19:00' })
    const dup = await createPlan(app, { placeId: 'wolf', date: '2026-12-03', time: '12:00' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error.message).toBe('That restaurant is already planned for that day.')
    const other = (await createPlan(app, { placeId: 'wolf', date: '2026-12-04', time: '19:00' })).json().plan
    expect((await app.inject({ method: 'PATCH', url: `/api/plans/${other.id}`, payload: { date: '2026-12-03' } })).statusCode).toBe(409)
  })

  it('survives a server restart', async () => {
    const dir = tempDir()
    const first = await makeApp({ dir })
    await createPlan(first.app, { placeId: 'wolf', date: '2026-12-03', time: '19:30' })
    await first.app.inject({ method: 'PUT', url: '/api/favorites/canlis' })
    await first.app.close()

    const second = await start({ dir })
    expect((await second.inject('/api/plans')).json().plans).toMatchObject([{ placeId: 'wolf', date: '2026-12-03', time: '19:30' }])
    expect((await second.inject('/api/favorites')).json().favorites).toMatchObject([{ placeId: 'canlis' }])
    expect((await second.inject('/api/health')).json().places).toBe(68)
  })

  it('keeps exactly one plan when 25 identical requests arrive at once', async () => {
    const app = await start()
    const results = await Promise.all(Array.from({ length: 25 }, () => createPlan(app, { placeId: 'wolf', date: '2026-12-05', time: '19:00' })))
    const codes = results.map((r) => r.statusCode).sort()
    expect(codes.filter((c) => c === 201)).toHaveLength(1)
    expect(codes.filter((c) => c === 409)).toHaveLength(24)
    expect((await app.inject('/api/plans')).json().plans).toHaveLength(1)
  })

  it('keeps all plans when 30 different requests arrive at once', async () => {
    const app = await start()
    const ids = (await app.inject('/api/places')).json().places.slice(0, 30).map((p: { id: string }) => p.id)
    const results = await Promise.all(ids.map((placeId: string) => createPlan(app, { placeId, date: '2026-12-06', time: '19:00' })))
    expect(results.every((r) => r.statusCode === 201)).toBe(true)
    expect((await app.inject('/api/plans')).json().plans).toHaveLength(30)
  })

  it('enforces uniqueness across two connections to the same database file', () => {
    const file = join(tempDir(), 'shared.db')
    const a = new Db(file)
    const b = new Db(file)
    seedPlaces(a)
    a.createPlan('demo-user', { placeId: 'wolf', date: '2026-12-07', time: '19:00' })
    expect(() => b.createPlan('demo-user', { placeId: 'wolf', date: '2026-12-07', time: '20:00' })).toThrow(UniqueViolation)
    expect(b.listPlans('demo-user')).toHaveLength(1)
    a.close()
    b.close()
  })
})

describe('favorites', () => {
  it('is idempotent both ways', async () => {
    const app = await start()
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'PUT', url: '/api/favorites/canlis' })).statusCode).toBe(200)
    expect((await app.inject('/api/favorites')).json().favorites).toHaveLength(1)
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: 'DELETE', url: '/api/favorites/canlis' })).statusCode).toBe(204)
    expect((await app.inject('/api/favorites')).json().favorites).toHaveLength(0)
  })

  it('handles rapid concurrent toggles without duplicates or errors', async () => {
    const app = await start()
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => app.inject({ method: i % 2 ? 'DELETE' : 'PUT', url: '/api/favorites/wolf' })),
    )
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 204)).toBe(true)
    expect((await app.inject('/api/favorites')).json().favorites.length).toBeLessThanOrEqual(1)
  })

  it('404s unknown places', async () => {
    const app = await start()
    expect((await app.inject({ method: 'PUT', url: '/api/favorites/made-up' })).statusCode).toBe(404)
  })
})
