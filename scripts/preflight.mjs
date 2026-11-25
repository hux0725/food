#!/usr/bin/env node
/**
 * Backstage preflight. Usage:
 *   npm run preflight                          # checks http://127.0.0.1:3001
 *   npm run preflight -- https://your-app.onrender.com
 * Prints GREEN / YELLOW / RED per check, finishes in under 30 s, exits 1 if anything is RED.
 * Read-only except for one probe plan, which it creates and deletes again.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = (process.argv[2] || process.env.PREFLIGHT_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const EXPECTED_PLACES = 68
const REQUEST_TIMEOUT_MS = 8000
const BUDGET_MS = 28_000
const started = Date.now()

const demoSource = readFileSync(resolve(import.meta.dirname, '../server/src/assistant/demoQueries.ts'), 'utf8')
const DEMO_QUERIES = [...demoSource.slice(demoSource.indexOf('DEMO_QUERIES'), demoSource.indexOf('] as const')).matchAll(/'([^']+)'/g)].map((m) => m[1])
const NOTHING_FITS_QUERY = /under \$5\b/

const color = process.stdout.isTTY ? { GREEN: '\x1b[32m', YELLOW: '\x1b[33m', RED: '\x1b[31m', reset: '\x1b[0m', dim: '\x1b[2m' } : { GREEN: '', YELLOW: '', RED: '', reset: '', dim: '' }
const results = []
function report(level, name, detail = '') {
  results.push({ level, name, detail })
  console.log(`${color[level]}${level.padEnd(6)}${color.reset} ${name}${detail ? `${color.dim} — ${detail}${color.reset}` : ''}`)
}

async function call(path, init = {}) {
  const remaining = BUDGET_MS - (Date.now() - started)
  if (remaining < 500) throw new Error('preflight time budget used up')
  const t0 = performance.now()
  const response = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)) })
  const ms = Math.round(performance.now() - t0)
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: response.status, headers: response.headers, text, json, ms }
}

const postJson = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

function seattleNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, hour: Number(parts.hour) }
}

async function check(name, fn) {
  try {
    await fn()
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000}s` : error?.cause?.code ?? error?.message ?? String(error)
    report('RED', name, reason)
  }
}

console.log(`Preflight for ${BASE}\n`)

let health
await check('Server and database (/api/health)', async () => {
  const r = await call('/api/health')
  health = r.json
  if (r.status !== 200 || r.json?.status !== 'ok') return report('RED', 'Server and database (/api/health)', `HTTP ${r.status}, ${r.text.slice(0, 120)}`)
  if (!r.json.db) return report('RED', 'Server and database (/api/health)', 'database not OK')
  if (r.json.places !== EXPECTED_PLACES) return report('RED', 'Server and database (/api/health)', `${r.json.places} places, expected ${EXPECTED_PLACES}`)
  const cold = r.ms > 5000 ? ' (slow: the host was probably asleep; it is warm now)' : ''
  report(r.ms > 5000 ? 'YELLOW' : 'GREEN', 'Server and database (/api/health)', `${r.json.places} places, version ${r.json.version}, up ${r.json.uptimeSeconds}s, ${r.ms} ms${cold}`)
})

if (!health) {
  console.log(`\n${color.RED}RED: the server is not reachable. Nothing else can be checked.${color.reset}`)
  console.log('Next: open BACKUP_PLAN.md, section "Deployed URL is down".')
  process.exit(1)
}

await check('LLM key configured', async () => {
  if (health.llmConfigured) report('GREEN', 'LLM key configured', 'live model answers, with cache and local fallback')
  else report('YELLOW', 'LLM key configured', 'no key: answers come from the cache and local matcher (the demo still works)')
})

await check('App page and script load', async () => {
  const page = await call('/')
  if (page.status !== 200 || !page.text.includes('<div id="root">')) return report('RED', 'App page and script load', `HTTP ${page.status}`)
  const script = page.text.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
  if (!script) return report('RED', 'App page and script load', 'no script tag in index.html')
  const js = await call(script)
  if (js.status !== 200 || js.text.length < 10_000) return report('RED', 'App page and script load', `${script}: HTTP ${js.status}`)
  report('GREEN', 'App page and script load', `${page.ms} ms page, ${js.ms} ms script (${Math.round(js.text.length / 1024)} KB)`)
})

await check('Security headers', async () => {
  const r = await call('/')
  const missing = ['content-security-policy', 'x-content-type-options'].filter((h) => !r.headers.get(h))
  report(missing.length ? 'YELLOW' : 'GREEN', 'Security headers', missing.length ? `missing ${missing.join(', ')}` : 'CSP, nosniff present')
})

await check('HTTPS', async () => {
  const local = /^http:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(BASE)
  if (BASE.startsWith('https://')) report('GREEN', 'HTTPS', 'location and microphone prompts are allowed')
  else if (local) report('GREEN', 'HTTPS', 'localhost: browsers treat it as secure')
  else report('YELLOW', 'HTTPS', 'plain http: "sort by my location" and the mic will not work')
})

await check('Places API', async () => {
  const r = await call('/api/places')
  if (r.status !== 200 || r.json?.count !== EXPECTED_PLACES) return report('RED', 'Places API', `HTTP ${r.status}, count ${r.json?.count}`)
  report('GREEN', 'Places API', `${r.json.count} places, ${r.ms} ms`)
})

await check('Photos', async () => {
  const r = await fetch(`${BASE}/photos/pasta.jpg`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (r.status !== 200) return report('RED', 'Photos', `/photos/pasta.jpg HTTP ${r.status}`)
  report('GREEN', 'Photos', 'served')
})

const latencies = []
for (const query of DEMO_QUERIES) {
  await check(`Demo query "${query}"`, async () => {
    const r = await postJson('/api/assistant', { message: query, mode: 'walk' })
    latencies.push(r.ms)
    if (r.status !== 200) return report('RED', `Demo query "${query}"`, `HTTP ${r.status} ${r.json?.error?.message ?? ''}`)
    const picks = r.json.rankedIds?.length ?? 0
    const expectNone = NOTHING_FITS_QUERY.test(query)
    const ok = expectNone ? picks === 0 && /^Nothing fits/.test(r.json.reply) : picks === 3
    const detail = `${picks} picks, source ${r.json.source}, ${r.ms} ms`
    if (!ok) return report('RED', `Demo query "${query}"`, `${detail}; expected ${expectNone ? 'the "nothing fits" answer' : '3 picks'}`)
    if (r.ms > 3000) return report('YELLOW', `Demo query "${query}"`, `${detail} (slow)`)
    if (health.llmConfigured && r.json.source === 'local' && !expectNone) return report('YELLOW', `Demo query "${query}"`, `${detail}: the model did not answer; local fallback used`)
    report('GREEN', `Demo query "${query}"`, detail)
  })
}

await check('Plans round trip (create + delete a probe plan)', async () => {
  const name = 'Plans round trip (create + delete a probe plan)'
  const probe = { placeId: 'wolf', date: '2099-12-31', time: '19:00' }
  const existing = (await call('/api/plans')).json?.plans ?? []
  for (const plan of existing.filter((p) => p.placeId === probe.placeId && p.date === probe.date)) await call(`/api/plans/${plan.id}`, { method: 'DELETE' })
  const created = await postJson('/api/plans', probe)
  if (created.status !== 201) return report('RED', name, `create: HTTP ${created.status} ${created.json?.error?.message ?? ''}`)
  const removed = await call(`/api/plans/${created.json.plan.id}`, { method: 'DELETE' })
  if (removed.status !== 204) return report('RED', name, `delete: HTTP ${removed.status}`)
  report('GREEN', name, `${created.ms + removed.ms} ms, nothing left behind`)
})

await check('Demo data', async () => {
  const plans = (await call('/api/plans')).json?.plans ?? []
  const favorites = (await call('/api/favorites')).json?.favorites ?? []
  const detail = `${plans.length} plans, ${favorites.length} saved places`
  report(plans.length || favorites.length ? 'YELLOW' : 'GREEN', 'Demo data', plans.length || favorites.length ? `${detail} left from rehearsal (fine if intended; reset: npm run reset-demo on the host)` : `${detail}: clean slate`)
})

await check('Stage settings', async () => {
  const status = (await call('/api/ai/status')).json ?? {}
  const keyRoute = await postJson('/api/ai/key', { apiKey: 'preflight-probe' })
  const notes = []
  if (status.demoDebug) notes.push('DEMO_DEBUG is on: source tags are visible to the audience')
  if (status.keyPromptEnabled || keyRoute.status !== 404) notes.push('the in-app key prompt is enabled (development setting)')
  report(notes.length ? 'YELLOW' : 'GREEN', 'Stage settings', notes.length ? notes.join('; ') : 'debug tags off, key prompt off')
})

// The browser fetches the weather directly, so this checks the network of the machine running preflight.
try {
  const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=47.6097&longitude=-122.3422&current=temperature_2m', { signal: AbortSignal.timeout(3000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  report('GREEN', 'Weather service (from this machine)', 'reachable: live weather will show')
} catch {
  report('YELLOW', 'Weather service (from this machine)', 'unreachable: the app will show sample weather labeled SIMULATED')
}

const sea = seattleNow()
const moment = sea.hour < 11 ? 'breakfast' : sea.hour < 16 ? 'lunch' : 'dinner'
console.log(`\n${color.dim}Seattle time ${sea.date} ${sea.time} (${moment}). Demo query p50 ${median(latencies)} ms, max ${Math.max(0, ...latencies)} ms.${color.reset}`)

const red = results.filter((r) => r.level === 'RED').length
const yellow = results.filter((r) => r.level === 'YELLOW').length
const seconds = ((Date.now() - started) / 1000).toFixed(1)
const overall = red ? 'RED' : yellow ? 'YELLOW' : 'GREEN'
console.log(`${color[overall]}${overall}${color.reset}: ${results.length - red - yellow} green, ${yellow} yellow, ${red} red in ${seconds}s`)
if (red) console.log('Do not go on stage with RED. See BACKUP_PLAN.md.')
process.exit(red ? 1 : 0)

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
