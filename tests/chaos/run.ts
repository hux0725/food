/**
 * Chaos checks (T8) against the real server process: graceful shutdown, crash during writes, corrupt files,
 * bad config, port clash, request bursts, and the server dying under an open browser tab.
 * Writes artifacts/chaos/report.md. Exits 1 if any check fails.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from '@playwright/test'
import { startServer, waitForExit } from './server'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'artifacts', 'chaos')
let nextPort = 3300
const results: Array<{ name: string; ok: boolean; detail: string }> = []

function dataEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'sfd-chaos-'))
  return { dir, env: { PORT: String(nextPort++), DB_PATH: join(dir, 'app.db'), CACHE_PATH: join(dir, 'cache.json') } }
}

async function step(name: string, fn: () => Promise<string>) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: `${detail} (${Date.now() - t0} ms)` })
    console.log(`PASS  ${name} — ${detail}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error)
    results.push({ name, ok: false, detail })
    console.log(`FAIL  ${name} — ${detail}`)
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const json = async (res: Response) => res.json() as Promise<Record<string, unknown> & { plans?: unknown[]; error?: { code: string } }>
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const PLACES = ['wolf', 'canlis', 'artusi', 'lamedusa', 'pestle', 'bastille', 'chowder', 'doughzone']
const futureDate = (i: number) => `2027-0${1 + (i % 9)}-${String(10 + (i % 18)).padStart(2, '0')}`

await step('SIGTERM shuts down cleanly with exit code 0', async () => {
  const { env } = dataEnv()
  const server = await startServer(env)
  const inflight = fetch(`${server.url}/api/places`).then(
    (r) => String(r.status),
    () => 'refused (server already closing)',
  )
  const code = await server.stop('SIGTERM')
  const status = await inflight
  assert(code === 0, `exit code ${code}`)
  assert(/SIGTERM received/.test(server.logs()), 'no shutdown log line')
  return `exit 0, in-flight request → ${status}`
})

await step('SIGTERM with an open keep-alive connection and a stalled request still exits cleanly and fast', async () => {
  const { env } = dataEnv()
  const server = await startServer(env)
  const { port, hostname } = new URL(server.url)
  // Raw socket that finishes one request and then stays open, like a browser tab on the page.
  const socket = net.connect(Number(port), hostname)
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.once('data', () => resolve())
    socket.write(`GET /api/health HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\n\r\n`)
  })
  // A second socket that started a request and never finished it (a stalled upload or a flaky network).
  const stalled = net.connect(Number(port), hostname)
  await new Promise<void>((resolve, reject) => {
    stalled.once('error', reject)
    stalled.once('connect', () => {
      stalled.write(`POST /api/plans HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{"placeId":`)
      setTimeout(resolve, 200)
    })
  })
  const started = Date.now()
  const code = await server.stop('SIGTERM')
  const took = Date.now() - started
  socket.destroy()
  stalled.destroy()
  assert(code === 0, `exit code ${code}: ${server.logs().split('\n').filter((l) => /too long/.test(l)).join('')}`)
  assert(took < 5000, `took ${took} ms to stop`)
  return `exit 0 in ${took} ms with the connection still open`
})

await step('Plans and favorites survive a restart', async () => {
  const { env } = dataEnv()
  let server = await startServer(env)
  assert((await post(`${server.url}/api/plans`, { placeId: 'wolf', date: '2027-03-04', time: '19:00' })).status === 201, 'create failed')
  await fetch(`${server.url}/api/favorites/canlis`, { method: 'PUT' })
  await server.stop()
  server = await startServer(env)
  const plans = (await json(await fetch(`${server.url}/api/plans`))).plans ?? []
  const favorites = ((await json(await fetch(`${server.url}/api/favorites`))) as { favorites: unknown[] }).favorites
  await server.stop()
  assert(plans.length === 1 && favorites.length === 1, `after restart: ${plans.length} plans, ${favorites.length} favorites`)
  return '1 plan and 1 favorite after restart'
})

await step('kill -9 during a burst of 200 writes leaves a consistent database', async () => {
  const { env } = dataEnv()
  let server = await startServer(env)
  const writes = Array.from({ length: 200 }, (_, i) => post(`${server.url}/api/plans`, { placeId: PLACES[i % PLACES.length], date: futureDate(i), time: '19:00' }).then((r) => r.status).catch(() => 0))
  await new Promise((r) => setTimeout(r, 40))
  await server.stop('SIGKILL')
  const statuses = await Promise.all(writes)
  const acknowledged = statuses.filter((s) => s === 201).length
  const db = new DatabaseSync(env.DB_PATH)
  const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
  db.close()
  assert(integrity === 'ok', `integrity_check: ${integrity}`)
  server = await startServer(env)
  const health = await json(await fetch(`${server.url}/api/health`))
  const stored = ((await json(await fetch(`${server.url}/api/plans`))).plans ?? []).length
  await server.stop()
  assert(health.status === 'ok' && health.places === 68, `health after crash: ${JSON.stringify(health)}`)
  assert(stored >= acknowledged, `${acknowledged} writes were acknowledged but only ${stored} are stored`)
  return `${acknowledged} acknowledged before the kill, ${stored} stored, integrity ok`
})

await step('Corrupt assistant cache file is ignored', async () => {
  const { env } = dataEnv()
  writeFileSync(env.CACHE_PATH, '{"entries": [ this is not json')
  const server = await startServer(env)
  const res = await post(`${server.url}/api/assistant`, { message: 'pasta under $30' })
  const body = await json(res)
  await server.stop()
  assert(res.status === 200 && (body.rankedIds as string[]).length === 3, `assistant: ${res.status} ${JSON.stringify(body).slice(0, 120)}`)
  return `assistant answered (${body.source})`
})

await step('Corrupt database file → clear startup error, non-zero exit', async () => {
  const { env } = dataEnv()
  writeFileSync(env.DB_PATH, 'this is not a sqlite database'.repeat(200))
  const server = await startServer(env, { waitForHealth: false })
  const code = await waitForExit(server)
  assert(code !== null && code !== 0, `exit code ${code}`)
  assert(/DB_PATH|database/i.test(server.logs()), `no helpful message: ${server.logs().slice(-300)}`)
  return `exit ${code}: "${server.logs().trim().split('\n').find((l) => /database/i.test(l))?.slice(0, 110)}"`
})

await step('Key without a model → clear startup error, non-zero exit', async () => {
  const { env } = dataEnv()
  const server = await startServer({ ...env, LLM_API_KEY: 'chaos-google-key-0000000000000000000000' }, { waitForHealth: false })
  const code = await waitForExit(server)
  assert(code === 1, `exit code ${code}`)
  assert(/LLM_MODEL/.test(server.logs()), 'message does not mention LLM_MODEL')
  assert(!server.logs().includes('chaos-google-key'), 'the key was printed')
  return 'exit 1, mentions LLM_MODEL, key not printed'
})

await step('Port already in use → friendly message, non-zero exit', async () => {
  const { env } = dataEnv()
  const first = await startServer(env)
  const second = await startServer({ ...dataEnv().env, PORT: env.PORT }, { waitForHealth: false })
  const code = await waitForExit(second)
  await first.stop()
  assert(code === 1, `exit code ${code}`)
  assert(/already in use/.test(second.logs()) && /PORT=3002 npm start/.test(second.logs()), 'no friendly message')
  return 'exit 1 with the "already in use" hint'
})

// 100 connections at a time: macOS caps the pending-connection queue at 128 (kern.ipc.somaxconn), so opening
// 300 at once measures the laptop's kernel, not the server. One browser uses about 6.
await step('Burst of 300 mixed requests, 100 at a time: no 5xx, server stays up', async () => {
  const { env } = dataEnv()
  const server = await startServer(env)
  const paths = ['/api/health', '/api/places', '/api/places/wolf', '/', '/api/plans', '/api/favorites']
  const t0 = performance.now()
  const failure = (error: unknown) => `network:${(error as { cause?: { code?: string } }).cause?.code ?? 'unknown'}`
  const one = (i: number) =>
    (i % 5 === 0 ? post(`${server.url}/api/assistant`, { message: ['pizza', 'ramen', 'tacos'][i % 3] }) : fetch(`${server.url}${paths[i % paths.length]}`)).then(
      (r) => r.status,
      failure,
    )
  const statuses: Array<number | string> = []
  let next = 0
  await Promise.all(
    Array.from({ length: 100 }, async () => {
      while (next < 300) statuses.push(await one(next++))
    }),
  )
  const ms = Math.round(performance.now() - t0)
  const health = await fetch(`${server.url}/api/health`)
  await server.stop()
  const counts = statuses.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {})
  assert(!statuses.some((s) => typeof s === 'string' || s >= 500), `failures seen: ${JSON.stringify(counts)}`)
  assert(health.status === 200, 'server unhealthy after burst')
  return `${JSON.stringify(counts)} in ${ms} ms`
})

await step('Server dies under an open tab → friendly messages; comes back → retry works', async () => {
  const { env } = dataEnv()
  let server = await startServer(env)
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    page.on('pageerror', (e) => consoleErrors.push(e.message))
    await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ json: { current: { temperature_2m: 50, weather_code: 3 } } }))
    await page.goto(server.url)
    await page.getByTestId('result-count').waitFor()
    await server.stop('SIGKILL')

    await page.getByTestId('open-assistant').click()
    await page.getByTestId('chat-input').fill('pasta under $30')
    await page.getByTestId('chat-send').click()
    await page.getByTestId('chat-pick').nth(2).waitFor({ timeout: 12_000 })

    await page.getByTestId('place-card').first().locator('.plan-btn').click()
    await page.getByTestId('save-plan').click()
    const error = page.getByTestId('schedule-error')
    await error.waitFor({ timeout: 12_000 })
    const message = await error.innerText()
    assert(!/fetch|500|undefined|error/i.test(message), `unfriendly message: ${message}`)

    server = await startServer(env)
    await page.getByTestId('save-plan').click()
    await page.getByTestId('confirmation').waitFor({ timeout: 8000 })
    assert(consoleErrors.length === 0, `page errors: ${consoleErrors.join('; ')}`)
    return `offline: assistant answered locally; save showed "${message}"; after restart the retry saved`
  } finally {
    await browser.close()
    await server.stop()
  }
})

mkdirSync(OUT, { recursive: true })
const failed = results.filter((r) => !r.ok)
writeFileSync(
  join(OUT, 'report.md'),
  ['# Chaos checks', '', `${results.length - failed.length}/${results.length} passed.`, '', '| Check | Result | Detail |', '| --- | --- | --- |', ...results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '\\|')} |`), ''].join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} chaos checks passed. Report: artifacts/chaos/report.md`)
process.exit(failed.length ? 1 : 0)
