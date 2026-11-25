/**
 * Assistant eval (T4). Runs every case through the real HTTP route:
 *   - always against the local matcher (no model),
 *   - and, when server/.env has LLM_API_KEY and LLM_MODEL, against the live model three times (fresh cache each run).
 * Writes artifacts/eval/report.json and report.md. Exits 1 if any hard rule is broken.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MAX_REASON_CHARS } from '../../shared/assistant-core'
import { toAssistantPlace } from '../../shared/places'
import type { AssistantResponse, TravelMode } from '../../shared/types'
import { places } from '../../src/data/places'
import { makeApp, offlineProvider } from '../api/helpers'
import { googleProvider } from '../../server/src/llm/google'
import { LlmKeyStore } from '../../server/src/llm/keyStore'
import { EVAL_CASES, type EvalCase } from './queries'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'artifacts', 'eval')
const LIVE_RUNS = 3

const envFile = join(ROOT, 'server', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const key = process.env.LLM_API_KEY?.trim()
const model = process.env.LLM_MODEL?.trim()
const skipLive = process.argv.includes('--local-only')

type Result = { q: string; run: string; ms: number; source: string; picks: string[]; errors: string[] }

function check(c: EvalCase, status: number, body: AssistantResponse): string[] {
  const errors: string[] = []
  if (status !== 200) return [`HTTP ${status}`]
  if (typeof body.reply !== 'string' || !body.reply.trim()) errors.push('empty reply')
  if (body.rankedIds.length > 3) errors.push(`${body.rankedIds.length} picks (max 3)`)
  if (c.minPicks && body.rankedIds.length < c.minPicks) errors.push(`only ${body.rankedIds.length} picks, wanted ${c.minPicks}+`)
  if (c.noPicks && body.rankedIds.length) errors.push('expected no picks')
  if (c.reply && !c.reply.test(body.reply)) errors.push(`reply "${body.reply.slice(0, 80)}" does not match ${c.reply}`)
  if (/<script/i.test(body.reply)) errors.push('reply echoes markup')
  const mode: TravelMode = c.mode ?? 'walk'
  for (const id of body.rankedIds) {
    const raw = places.find((place) => place.id === id)
    if (!raw) {
      errors.push(`unknown id ${id}`)
      continue
    }
    const place = toAssistantPlace(raw, mode)
    const cuisines = c.cuisine ? [c.cuisine].flat() : null
    if (cuisines && !cuisines.includes(place.cuisine)) errors.push(`${id} is ${place.cuisine}, not ${cuisines.join('/')}`)
    if (c.neighborhood && place.neighborhood !== c.neighborhood) errors.push(`${id} is in ${place.neighborhood}`)
    if (c.maxPrice != null && place.serving > c.maxPrice) errors.push(`${id} costs $${place.serving} > $${c.maxPrice}`)
    const total = place.travelMinutes + place.waitMinutes
    if (c.maxTotalMinutes != null && total > c.maxTotalMinutes) errors.push(`${id} takes ${total} min > ${c.maxTotalMinutes}`)
    if (c.forbiddenIds?.includes(id)) errors.push(`forbidden id ${id}`)
    const reason = body.reasons[id]
    if (!reason || reason.length > MAX_REASON_CHARS) errors.push(`${id} reason missing or over ${MAX_REASON_CHARS} chars`)
  }
  return errors
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

async function runAll(label: string, provider: Parameters<typeof makeApp>[0]['provider']): Promise<Result[]> {
  const { app } = await makeApp({ provider, assistantPerMinute: 10_000, llmPerMinute: 10_000 })
  const results: Result[] = []
  try {
    for (const c of EVAL_CASES) {
      const started = performance.now()
      const res = await app.inject({
        method: 'POST',
        url: '/api/assistant',
        payload: { message: c.q, mode: c.mode ?? 'walk', neighborhood: c.context?.neighborhood ?? null, cuisine: c.context?.cuisine ?? null, budget: c.context?.budget ?? null },
      })
      const ms = Math.round(performance.now() - started)
      const body = res.json() as AssistantResponse
      results.push({ q: c.q, run: label, ms, source: body.source, picks: body.rankedIds ?? [], errors: check(c, res.statusCode, body) })
    }
  } finally {
    await app.close()
  }
  return results
}

function summarize(label: string, results: Result[]) {
  const ms = results.map((r) => r.ms)
  const sources = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.source]: (acc[r.source] ?? 0) + 1 }), {})
  return { label, queries: results.length, failures: results.filter((r) => r.errors.length).length, p50: percentile(ms, 50), p95: percentile(ms, 95), max: Math.max(...ms), sources }
}

const local = await runAll('local', offlineProvider())
const live: Result[] = []
let liveStatus: string
if (skipLive) liveStatus = 'NOT RUN (--local-only)'
else if (!key || !model) liveStatus = 'NOT RUN (no LLM_API_KEY / LLM_MODEL in server/.env)'
else {
  for (let run = 1; run <= LIVE_RUNS; run++) {
    live.push(...(await runAll(`live-${run}`, googleProvider(new LlmKeyStore(key, null), model))))
  }
  liveStatus = `RUN (${model}, ${LIVE_RUNS} runs)`
}

const summaries = [summarize('local', local), ...(live.length ? [summarize('live (all runs)', live)] : [])]
const failures = [...local, ...live].filter((r) => r.errors.length)

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), cases: EVAL_CASES.length, liveStatus, summaries, results: [...local, ...live] }, null, 2))
const md = [
  '# Assistant eval',
  '',
  `Cases: ${EVAL_CASES.length}. Live model: ${liveStatus}.`,
  '',
  '| Run | Queries | Failures | p50 ms | p95 ms | max ms | Sources |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...summaries.map((s) => `| ${s.label} | ${s.queries} | ${s.failures} | ${s.p50} | ${s.p95} | ${s.max} | ${Object.entries(s.sources).map(([k, v]) => `${k}: ${v}`).join(', ')} |`),
  '',
  '## Per query (local run)',
  '',
  '| Query | Picks | ms | Result |',
  '| --- | --- | --- | --- |',
  ...local.map((r) => `| ${r.q.slice(0, 60).replace(/\|/g, '\\|') || '(empty)'} | ${r.picks.join(', ') || '—'} | ${r.ms} | ${r.errors.length ? `FAIL: ${r.errors.join('; ')}` : 'ok'} |`),
  '',
].join('\n')
writeFileSync(join(OUT, 'report.md'), md)

for (const s of summaries) console.log(`${s.label}: ${s.queries} queries, ${s.failures} failed, p50 ${s.p50} ms, p95 ${s.p95} ms, sources ${JSON.stringify(s.sources)}`)
console.log(`live model: ${liveStatus}`)
for (const f of failures) console.log(`FAIL [${f.run}] "${f.q.slice(0, 60)}": ${f.errors.join('; ')}`)
console.log(`report: ${join(OUT, 'report.md')}`)
process.exit(failures.length ? 1 : 0)
