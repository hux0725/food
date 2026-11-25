#!/usr/bin/env node
/**
 * Lighthouse (T7), mobile and desktop presets, against a running server.
 *   node tests/lighthouse/run.mjs [baseUrl]      (default http://127.0.0.1:3001)
 * Uses Playwright's Chromium. Reports go to artifacts/lighthouse/. Exits 1 if a score is under its bar.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'artifacts', 'lighthouse')
const URL = (process.argv[2] || 'http://127.0.0.1:3001').replace(/\/+$/, '') + '/'
const BARS = {
  mobile: { performance: 80, accessibility: 95, 'best-practices': 90, seo: 90 },
  desktop: { performance: 90, accessibility: 95, 'best-practices': 90, seo: 90 },
}

mkdirSync(OUT, { recursive: true })
let failed = false
for (const preset of ['mobile', 'desktop']) {
  const base = join(OUT, preset)
  const args = [
    URL,
    '--quiet',
    '--output=json',
    '--output=html',
    `--output-path=${base}`,
    '--only-categories=performance,accessibility,best-practices,seo',
    '--chrome-flags=--headless=new --no-sandbox',
  ]
  if (preset === 'desktop') args.push('--preset=desktop')
  execFileSync(join(ROOT, 'node_modules/.bin/lighthouse'), args, { env: { ...process.env, CHROME_PATH: chromium.executablePath() }, stdio: 'inherit' })
  const report = JSON.parse(readFileSync(`${base}.report.json`, 'utf8'))
  const scores = Object.fromEntries(Object.entries(report.categories).map(([id, c]) => [id, Math.round(c.score * 100)]))
  const misses = Object.entries(BARS[preset]).filter(([id, bar]) => scores[id] < bar)
  const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'].map((id) => `${id.replace(/-/g, ' ')} ${report.audits[id].displayValue}`)
  console.log(`${preset}: ${Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`  ${metrics.join(' · ')}`)
  for (const [id, bar] of misses) console.log(`  BELOW BAR: ${id} ${scores[id]} < ${bar}`)
  if (misses.length) failed = true
}
console.log(`reports: ${OUT}`)
process.exit(failed ? 1 : 0)
