#!/usr/bin/env node
/**
 * Fails if the built front end (dist/) contains anything that looks like a secret:
 * Google/Anthropic/OpenAI-style keys, the LLM_API_KEY name, private keys, or the actual key from server/.env.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('RED  dist/ is missing. Run `npm run build` first.')
  process.exit(1)
}

const patterns = [
  [/AIza[0-9A-Za-z_-]{30,}/, 'Google API key'],
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/, 'OpenAI-style API key'],
  [/LLM_API_KEY/, 'LLM_API_KEY variable name'],
  [/x-api-key/i, 'x-api-key header'],
  [/x-goog-api-key/i, 'x-goog-api-key header'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
]

let realKey = ''
const envFile = join(root, 'server', '.env')
if (existsSync(envFile)) {
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('LLM_API_KEY='))
  realKey = line?.slice('LLM_API_KEY='.length).trim().replace(/^["']|["']$/g, '') ?? ''
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else yield path
  }
}

const findings = []
let scanned = 0
for (const file of files(dist)) {
  if (!/\.(js|css|html|json|map|txt|svg|webmanifest)$/.test(file)) continue
  scanned++
  const text = readFileSync(file, 'utf8')
  for (const [pattern, label] of patterns) if (pattern.test(text)) findings.push(`${relative(root, file)}: ${label}`)
  if (realKey && text.includes(realKey)) findings.push(`${relative(root, file)}: the actual key from server/.env`)
}

if (findings.length) {
  for (const finding of findings) console.error(`RED  ${finding}`)
  process.exit(1)
}
console.log(`GREEN  no secrets in dist/ (${scanned} text files scanned${realKey ? ', including the real key' : ''})`)
