import { afterEach, describe, expect, it } from 'vitest'
import { googleProvider } from '../../server/src/llm/google'
import { LlmKeyStore } from '../../server/src/llm/keyStore'
import { makeApp, tempDir, writeDist, type TestApp } from './helpers'

let current: TestApp | undefined
afterEach(async () => {
  await current?.app.close()
  current = undefined
})
async function start(...args: Parameters<typeof makeApp>) {
  current = await makeApp(...args)
  return current.app
}

describe('health', () => {
  it('reports status, version, uptime, place count, db, and an llm boolean only', async () => {
    const app = await start()
    const res = await app.inject('/api/health')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const body = res.json()
    expect(Object.keys(body).sort()).toEqual(['db', 'llmConfigured', 'places', 'status', 'time', 'uptimeSeconds', 'version'])
    expect(body).toMatchObject({ status: 'ok', places: 68, db: true, llmConfigured: false })
    expect(typeof body.version).toBe('string')
    expect(Number.isInteger(body.uptimeSeconds)).toBe(true)
  })

  it('answers 503 degraded when the database is gone', async () => {
    const app = await start()
    app.db.close()
    const res = await app.inject('/api/health')
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ status: 'degraded', db: false, places: 0 })
  })
})

describe('places', () => {
  it('lists all 68 and filters by neighborhood, cuisine, price and text', async () => {
    const app = await start()
    expect((await app.inject('/api/places')).json().count).toBe(68)
    const ballard = (await app.inject('/api/places?neighborhood=ballard')).json()
    expect(ballard.count).toBeGreaterThan(0)
    for (const place of ballard.places) expect(place.neighborhood).toBe('Ballard')
    const cheap = (await app.inject('/api/places?maxPrice=15')).json()
    for (const place of cheap.places) expect(place.serving).toBeLessThanOrEqual(15)
    const pasta = (await app.inject('/api/places?q=pasta')).json()
    expect(pasta.count).toBeGreaterThan(0)
    const wildcard = (await app.inject('/api/places?q=%25')).json()
    expect(wildcard.count).toBe(0)
  })

  it('treats SQL in filters as plain text', async () => {
    const app = await start()
    for (const q of ["' OR 1=1 --", "x'; DROP TABLE plans; --", '" OR ""="']) {
      const res = await app.inject(`/api/places?q=${encodeURIComponent(q)}`)
      expect(res.statusCode).toBe(200)
      expect(res.json().count).toBe(0)
    }
    const hood = await app.inject(`/api/places?neighborhood=${encodeURIComponent("Ballard' OR '1'='1")}`)
    expect(hood.json().count).toBe(0)
    expect((await app.inject('/api/health')).json().places).toBe(68)
    expect((await app.inject('/api/plans')).statusCode).toBe(200)
  })

  it('returns one place, 404 for an unknown id, 400 for a bad filter', async () => {
    const app = await start()
    expect((await app.inject('/api/places/wolf')).json().place.name).toBe('How to Cook a Wolf')
    const missing = await app.inject('/api/places/nope')
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('NOT_FOUND')
    expect((await app.inject('/api/places?maxPrice=-3')).statusCode).toBe(400)
  })
})

describe('errors, headers and static files', () => {
  it('uses one error shape for unknown routes, bad JSON and oversized bodies', async () => {
    const app = await start()
    const unknown = await app.inject('/api/nothing-here')
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND', message: expect.any(String) } })

    const badJson = await app.inject({ method: 'POST', url: '/api/plans', headers: { 'content-type': 'application/json' }, payload: '{"placeId":' })
    expect(badJson.statusCode).toBe(400)
    expect(badJson.json().error.message).not.toMatch(/Unexpected|SyntaxError|at JSON/)

    const huge = await app.inject({ method: 'POST', url: '/api/assistant', payload: { message: 'x'.repeat(40_000) } })
    expect(huge.statusCode).toBe(413)
    expect(huge.json().error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('sends security headers', async () => {
    const app = await start()
    const res = await app.inject('/api/health')
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['permissions-policy']).toContain('camera=()')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('serves the app shell for client routes but 404s missing files and API paths', async () => {
    const dir = tempDir()
    const app = await start({ dir, distDir: writeDist(dir) })
    const root = await app.inject('/')
    expect(root.statusCode).toBe(200)
    expect(root.body).toContain('<div id="root">')
    expect(root.headers['cache-control']).toBe('no-cache')
    const deep = await app.inject('/plans/some/deep/link')
    expect(deep.statusCode).toBe(200)
    expect(deep.body).toContain('<div id="root">')
    const asset = await app.inject('/assets/app.js')
    expect(asset.headers['cache-control']).toContain('immutable')
    expect((await app.inject('/missing.png')).statusCode).toBe(404)
    expect((await app.inject('/api/missing')).headers['content-type']).toContain('application/json')
  })
})

describe('AI status and key endpoint', () => {
  it('reports configuration without ever returning a key', async () => {
    const app = await start({ env: { LLM_API_KEY: 'test-google-secret-value-1234567890', LLM_MODEL: 'test-model' } })
    const res = await app.inject('/api/ai/status')
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('test-google-secret')
    expect(res.json()).toMatchObject({ provider: 'google', model: 'test-model' })
  })

  it('hides the key endpoint when the key prompt is off (the production default)', async () => {
    const app = await start({ env: { AI_KEY_PROMPT: 'off' } })
    const res = await app.inject({ method: 'POST', url: '/api/ai/key', payload: { apiKey: 'test-google-key-aaaaaaaaaaaaaaaaaaaa' } })
    expect(res.statusCode).toBe(404)
  })

  it('rejects malformed keys, keys from another vendor, and keys Google refuses', async () => {
    const verified: string[] = []
    const app = await start({
      env: { AI_KEY_PROMPT: 'on' },
      verifyKey: async (key) => {
        verified.push(key)
        return { ok: false, reason: 'rejected' }
      },
    })
    const post = (apiKey: string) => app.inject({ method: 'POST', url: '/api/ai/key', payload: { apiKey } })
    // Other vendors' key shapes are built at runtime so no key-looking literal sits in the repo (the security scan checks).
    const anthropicShaped = ['sk', 'ant', 'api03', 'a'.repeat(28)].join('-')
    const openAiShaped = ['sk', 'proj', 'a'.repeat(28)].join('-')
    for (const apiKey of ['hello', 'has spaces in it but is long enough to pass the length check', anthropicShaped, openAiShaped]) {
      const bad = await post(apiKey)
      expect(bad.statusCode).toBe(400)
      expect(bad.json().error.code).toBe('AI_KEY_FORMAT')
      expect(bad.json().error.message).toContain('Google')
    }
    // Wrong-looking keys never reach Google.
    expect(verified).toEqual([])
    const refused = await post('test-google-key-aaaaaaaaaaaaaaaaaaaa')
    expect(refused.json().error.code).toBe('AI_KEY_REJECTED')
    expect(refused.json().error.message).toContain('Google')
    expect(verified).toEqual(['test-google-key-aaaaaaaaaaaaaaaaaaaa'])
  })

  it('accepts a key Google confirms, and never echoes it back', async () => {
    // The real key store and Google provider, so /api/ai/status reflects what the saved key does.
    const keyStore = new LlmKeyStore(undefined, null)
    const app = await start({
      env: { AI_KEY_PROMPT: 'on', LLM_MODEL: 'test-model' },
      keyStore,
      provider: googleProvider(keyStore, 'test-model'),
      verifyKey: async () => ({ ok: true }),
    })
    expect((await app.inject('/api/ai/status')).json().configured).toBe(false)
    const key = 'test-google-key-aaaaaaaaaaaaaaaaaaaa'
    const res = await app.inject({ method: 'POST', url: '/api/ai/key', payload: { apiKey: key } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ configured: true, verified: true })
    expect(res.body).not.toContain(key)
    expect((await app.inject('/api/ai/status')).json().configured).toBe(true)
  })
})
