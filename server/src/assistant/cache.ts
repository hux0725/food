import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AssistantResponse } from '../../../shared/types.js'

const entrySchema = z.object({
  origin: z.enum(['llm', 'local']),
  createdAt: z.string(),
  response: z.object({
    reply: z.string(),
    preference: z.string().nullable(),
    neighborhood: z.string().nullable(),
    maxTravelMinutes: z.number().nullable(),
    maxBudget: z.number().nullable(),
    rankedIds: z.array(z.string()).max(3),
    reasons: z.record(z.string(), z.string()),
  }),
})
const fileSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), entrySchema) })

export type CacheEntry = z.infer<typeof entrySchema>

/**
 * Normalized query → answer. Pre-warmed with the demo script queries and persisted to a JSON file,
 * so a restart (or a dead LLM) still answers the demo instantly.
 */
export class AssistantCache {
  readonly #entries = new Map<string, CacheEntry>()

  constructor(
    private readonly path: string | null,
    private readonly maxEntries = 500,
  ) {
    this.#load()
  }

  #load() {
    if (!this.path || !existsSync(this.path)) return
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.path, 'utf8')))
      if (!parsed.success) return
      for (const [key, entry] of Object.entries(parsed.data.entries)) this.#entries.set(key, entry)
    } catch {
      // A corrupt cache file is ignored and rewritten on the next save.
    }
  }

  get size(): number {
    return this.#entries.size
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key)
    if (entry) {
      // Refresh recency for LRU eviction.
      this.#entries.delete(key)
      this.#entries.set(key, entry)
    }
    return entry
  }

  set(key: string, response: AssistantResponse, origin: CacheEntry['origin']) {
    const { reply, preference, neighborhood, maxTravelMinutes, maxBudget, rankedIds, reasons } = response
    this.#entries.delete(key)
    this.#entries.set(key, {
      origin,
      createdAt: new Date().toISOString(),
      response: { reply, preference, neighborhood, maxTravelMinutes, maxBudget, rankedIds, reasons },
    })
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
    this.#save()
  }

  #save() {
    if (!this.path) return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const temp = `${this.path}.tmp`
      writeFileSync(temp, JSON.stringify({ version: 1, entries: Object.fromEntries(this.#entries) }, null, 1))
      renameSync(temp, this.path)
    } catch {
      // The in-memory cache still works; persistence is best effort.
    }
  }
}
