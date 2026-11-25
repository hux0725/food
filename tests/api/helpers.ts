import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp, type App, type BuildOptions } from '../../server/src/app'
import type { LlmProvider, LlmRequest, LlmResult } from '../../server/src/assistant/provider'
import { loadEnv } from '../../server/src/env'

/** Fixed "now" for date rules: Tuesday 2026-11-24, 12:00 in Seattle. */
export const NOW = new Date('2026-11-24T20:00:00Z')
export const TODAY = '2026-11-24'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'seattle-food-test-'))
}

export type TestApp = { app: App; dir: string }

export async function makeApp(options: BuildOptions & { dir?: string; env?: Record<string, string> } = {}): Promise<TestApp> {
  const dir = options.dir ?? tempDir()
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DB_PATH: join(dir, 'test.db'),
    CACHE_PATH: join(dir, 'cache.json'),
    ...options.env,
  })
  const app = await buildApp(env, { distDir: join(dir, 'dist'), now: () => NOW, provider: options.provider ?? offlineProvider(), ...options })
  await app.ready()
  return { app, dir }
}

/** A dist folder with an index.html, for SPA fallback tests. */
export function writeDist(dir: string): string {
  const dist = join(dir, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Seattle Food Discovery</title><div id="root"></div>')
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
  return dist
}

export function offlineProvider(): LlmProvider {
  return {
    name: 'offline',
    ready: false,
    complete: async () => {
      throw new Error('offline provider should never be called')
    },
  }
}

type Step = (request: LlmRequest) => Promise<LlmResult> | LlmResult

/** Provider that answers from a script of steps and records every call. */
export function scriptedProvider(...steps: Step[]): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = []
  return {
    name: 'scripted',
    ready: true,
    calls,
    async complete(request) {
      calls.push(request)
      const step = steps[Math.min(calls.length - 1, steps.length - 1)]
      return step(request)
    },
  }
}

export const json = (value: unknown, tokens = { inputTokens: 900, outputTokens: 80 }): LlmResult => ({ text: JSON.stringify(value), ...tokens })

/** Ids the model is allowed to pick: read them from the prompt it was given. */
export function candidateIds(request: LlmRequest): string[] {
  return [...request.user.matchAll(/"id":\s*"([^"]+)"/g)].map((match) => match[1])
}

/** A stand-in for generativelanguage.googleapis.com (the Gemini API) on a random local port. */
export async function fakeGoogle(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void) {
  let hits = 0
  const server = createServer((req, res) => {
    hits++
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => handler(req, body, res))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    get hits() {
      return hits
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

export async function ask(app: App, message: string, extra: Record<string, unknown> = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/assistant', payload: { message, mode: 'walk', ...extra } })
  return { status: res.statusCode, body: res.json() }
}
