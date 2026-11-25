/**
 * Security checks (T9). Writes artifacts/security/report.md. Exits 1 on any failure.
 * - secrets: .env never tracked, no real-looking key anywhere in git history, none in dist/
 * - front end: no dangerouslySetInnerHTML / eval, no secret-looking VITE_ variables
 * - logs: production logs contain neither the key nor the user's message
 * - dependencies: npm audit (production deps) has no high or critical advisories
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startServer } from '../chaos/server'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'artifacts', 'security')
const results: Array<{ name: string; ok: boolean; detail: string }> = []
// A real-looking Google API key (AIza + 35 characters) or Anthropic key. Test fixtures must not match this.
const REAL_KEY = /(?:AIza[0-9A-Za-z_-]{35}|sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,})/

async function step(name: string, fn: () => Promise<string> | string) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`PASS  ${name} — ${detail}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    results.push({ name, ok: false, detail })
    console.log(`FAIL  ${name} — ${detail}`)
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else yield path
  }
}

await step('.env files are ignored and were never committed', () => {
  const tracked = git('ls-files').split('\n').filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith('.env.example'))
  assert(!tracked.length, `tracked: ${tracked.join(', ')}`)
  const ever = git('log', '--all', '--name-only', '--format=').split('\n').filter((f) => /(^|\/)\.env$/.test(f))
  assert(!ever.length, `in history: ${[...new Set(ever)].join(', ')}`)
  const ignored = git('check-ignore', 'server/.env', '.env').trim().split('\n')
  assert(ignored.length === 2, 'server/.env or .env is not ignored')
  return 'not tracked, not in history, ignored'
})

await step('No real-looking API key in any commit', () => {
  const history = git('log', '--all', '-p', '--format=')
  const match = history.match(REAL_KEY)
  assert(!match, `found ${match?.[0].slice(0, 14)}…`)
  return `${Math.round(history.length / 1024)} KB of history scanned`
})

await step('No real-looking API key in the working tree (outside ignored files)', () => {
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean)
  const hits = files.filter((file) => {
    try {
      return REAL_KEY.test(readFileSync(join(ROOT, file), 'utf8'))
    } catch {
      return false
    }
  })
  assert(!hits.length, hits.join(', '))
  return `${files.length} files scanned`
})

await step('Built front end contains no secrets', () => {
  const out = execFileSync(process.execPath, ['scripts/scan-dist.mjs'], { cwd: ROOT, encoding: 'utf8' })
  return out.trim()
})

await step('Front end: no raw HTML injection or eval', () => {
  const hits: string[] = []
  for (const file of walk(join(ROOT, 'src'))) {
    if (!/\.(tsx?|jsx?)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const pattern of [/dangerouslySetInnerHTML/, /\binnerHTML\s*=/, /\beval\(/, /new Function\(/]) if (pattern.test(text)) hits.push(`${file.slice(ROOT.length + 1)}: ${pattern}`)
  }
  assert(!hits.length, hits.join('; '))
  return 'none in src/'
})

await step('Front end: no secrets in VITE_ variables', () => {
  const hits: string[] = []
  for (const file of [...walk(join(ROOT, 'src')), join(ROOT, 'vite.config.ts'), join(ROOT, 'index.html')]) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/VITE_[A-Z0-9_]+/g)) if (/KEY|SECRET|TOKEN|PASSWORD/.test(match[0])) hits.push(`${file.slice(ROOT.length + 1)}: ${match[0]}`)
  }
  assert(!hits.length, hits.join('; '))
  return 'no VITE_*KEY/SECRET/TOKEN'
})

await step('Production logs contain neither the key nor user messages', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sfd-sec-'))
  // Built from pieces so this file itself never contains a real-looking key.
  const key = 'AIza' + 'SECURITYPROBE' + 'x'.repeat(30)
  const message = 'pasta under $30 my-private-message-7f3a'
  const server = await startServer({ PORT: '3390', DB_PATH: join(dir, 'app.db'), CACHE_PATH: join(dir, 'cache.json'), LLM_API_KEY: key, LLM_MODEL: 'probe-model' })
  try {
    const res = await fetch(`${server.url}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ message }) })
    assert(res.status === 200, `assistant HTTP ${res.status}`)
    const body = await res.text()
    assert(!body.includes(key), 'key in response body')
    const health = await (await fetch(`${server.url}/api/health`)).text()
    const status = await (await fetch(`${server.url}/api/ai/status`)).text()
    assert(!health.includes('AIza') && !status.includes('AIza'), 'key in health or status')
    await new Promise((r) => setTimeout(r, 300))
  } finally {
    await server.stop()
  }
  const logs = server.logs()
  assert(logs.length > 0, 'no logs captured')
  assert(!logs.includes('SECURITYPROBE'), 'the API key appears in the logs')
  assert(!logs.includes('my-private-message-7f3a'), 'the user message appears in the logs')
  assert(/assistant answered/.test(logs) && /messageChars/.test(logs), 'assistant log line missing (expected message length only)')
  return `${logs.split('\n').length} log lines checked`
})

for (const [label, dir] of [
  ['root', ROOT],
  ['server', join(ROOT, 'server')],
] as const) {
  await step(`npm audit (${label}, production dependencies): no high/critical`, () => {
    let raw: string
    try {
      raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      raw = (error as { stdout?: string }).stdout ?? ''
    }
    const report = JSON.parse(raw || '{}') as { metadata?: { vulnerabilities?: Record<string, number> }; error?: { summary?: string } }
    if (report.error) throw new Error(`audit could not run: ${report.error.summary}`)
    const v = report.metadata?.vulnerabilities ?? {}
    assert(!v.high && !v.critical, JSON.stringify(v))
    return JSON.stringify(v)
  })
}

mkdirSync(OUT, { recursive: true })
const failed = results.filter((r) => !r.ok)
writeFileSync(
  join(OUT, 'report.md'),
  ['# Security checks', '', `${results.length - failed.length}/${results.length} passed.`, '', '| Check | Result | Detail |', '| --- | --- | --- |', ...results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '\\|')} |`), ''].join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} security checks passed. Report: artifacts/security/report.md`)
process.exit(failed.length ? 1 : 0)
