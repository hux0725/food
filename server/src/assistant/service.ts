import { cacheKey, finalize, prepare, rankLocal, type CoreInput } from '../../../shared/assistant-core.js'
import { mealMomentFor, seattleDateTime, seattleHour } from '../../../shared/dates.js'
import { toAssistantPlace } from '../../../shared/places.js'
import type { AssistantPlace, AssistantResponse, AssistantSource, MealMoment, TravelMode } from '../../../shared/types.js'
import type { Db } from '../db/index.js'
import type { RateLimiter } from '../rateLimit.js'
import type { AssistantCache } from './cache.js'
import { MAX_CANDIDATES_FOR_MODEL, MAX_OUTPUT_TOKENS, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js'
import { LlmError, type LlmProvider, type LlmResult } from './provider.js'
import { groundPicks, parseModelOutput } from './validate.js'

export const DEFAULT_LLM_TIMEOUT_MS = 6000

export type AssistantInput = CoreInput & { seattleTime: string }

export type AnswerMeta = {
  source: AssistantSource
  latencyMs: number
  inputTokens: number
  outputTokens: number
  candidates: number
  llmAttempts: number
  llmError?: string
  dropped?: number
  rewritten?: number
  llmSkipped?: 'not_configured' | 'rate_limited'
}

type Logger = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }

export type AssistantServiceDeps = {
  db: Db
  provider: LlmProvider
  cache: AssistantCache
  llmLimiter: RateLimiter
  neighborhoods: string[]
  log: Logger
  timeoutMs?: number
}

class DeadlineError extends Error {}

/**
 * The fallback chain: exact cache hit → live LLM (6 s hard deadline, one retry on transient errors) → local matcher.
 * Every path returns the same response shape; only `source` differs.
 */
export class AssistantService {
  readonly #timeoutMs: number

  constructor(private readonly deps: AssistantServiceDeps) {
    this.#timeoutMs = deps.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS
  }

  #places(mode: TravelMode): AssistantPlace[] {
    return this.deps.db.listPlaces().map((place) => toAssistantPlace(place, mode))
  }

  async answer(input: AssistantInput, clientKey: string, options: { skipCache?: boolean } = {}): Promise<{ response: AssistantResponse; meta: AnswerMeta }> {
    const started = performance.now()
    const meta: AnswerMeta = { source: 'local', latencyMs: 0, inputTokens: 0, outputTokens: 0, candidates: 0, llmAttempts: 0 }
    const done = (response: AssistantResponse) => {
      meta.source = response.source
      meta.latencyMs = Math.round(performance.now() - started)
      return { response, meta }
    }

    const places = this.#places(input.mode)
    const prepared = prepare(input, places, this.deps.neighborhoods)
    if (prepared.kind === 'answer') return done(prepared.response)
    meta.candidates = prepared.candidates.length

    const key = cacheKey(input)
    const validIds = new Set(prepared.candidates.map((place) => place.id))
    const cached = options.skipCache ? undefined : this.deps.cache.get(key)
    if (cached && cached.response.rankedIds.length && cached.response.rankedIds.every((id) => validIds.has(id))) {
      return done({ ...cached.response, source: 'cache' })
    }

    const ranked = rankLocal(prepared.candidates, prepared.constraints)
    if (!this.deps.provider.ready) meta.llmSkipped = 'not_configured'
    else if (!this.deps.llmLimiter.allow(clientKey)) meta.llmSkipped = 'rate_limited'
    else {
      try {
        const result = await this.#callWithDeadline(
          {
            system: SYSTEM_PROMPT,
            user: buildUserPrompt({
              constraints: prepared.constraints,
              candidates: ranked.slice(0, MAX_CANDIDATES_FOR_MODEL),
              mode: input.mode,
              mealMoment: input.mealMoment,
              seattleTime: input.seattleTime,
            }),
          },
          meta,
        )
        meta.inputTokens = result.inputTokens
        meta.outputTokens = result.outputTokens
        const output = parseModelOutput(result.text)
        if (!output) throw new LlmError('bad_response')
        const grounded = groundPicks(output, prepared.candidates, prepared.constraints, input.mode)
        meta.dropped = grounded.dropped
        meta.rewritten = grounded.rewritten
        if (grounded.ranked.length) {
          const response = finalize(grounded.ranked, grounded.reasons, prepared.constraints, input.mode, 'llm')
          this.deps.cache.set(key, response, 'llm')
          return done(response)
        }
        // The model picked nothing usable although code found matching places: answer locally rather than show nothing.
        meta.llmError = `empty_${output.status}`
      } catch (error) {
        meta.llmError = error instanceof LlmError ? error.kind : error instanceof DeadlineError ? 'timeout' : 'unexpected'
      }
    }
    return done(finalize(ranked, {}, prepared.constraints, input.mode, 'local'))
  }

  async #callWithDeadline(prompt: { system: string; user: string }, meta: AnswerMeta): Promise<LlmResult> {
    const deadline = performance.now() + this.#timeoutMs
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - performance.now()
      if (remaining < 750) throw new DeadlineError()
      meta.llmAttempts++
      const controller = new AbortController()
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new DeadlineError())
        }, remaining)
      })
      try {
        return await Promise.race([
          this.deps.provider.complete({ ...prompt, maxTokens: MAX_OUTPUT_TOKENS, signal: controller.signal }),
          timeout,
        ])
      } catch (error) {
        if (!(error instanceof LlmError) || !error.transient || attempt === 1) throw error
      } finally {
        clearTimeout(timer)
      }
    }
    throw new DeadlineError()
  }

  /**
   * Fills the cache for the demo queries. Uses the live model when it is available, otherwise the local matcher.
   * Local-matcher entries are cheap and always rebuilt, so they never go stale after a code or data change;
   * live-model entries are kept (and upgraded from local ones once a key is present).
   */
  async prewarm(queries: string[], mode: TravelMode = 'walk'): Promise<{ llm: number; local: number; kept: number }> {
    const counts = { llm: 0, local: 0, kept: 0 }
    const mealMoment: MealMoment = mealMomentFor(seattleHour())
    for (const message of queries) {
      const input: AssistantInput = { message, mode, neighborhood: null, cuisine: null, budget: null, mealMoment, seattleTime: seattleDateTime() }
      const key = cacheKey(input)
      const existing = this.deps.cache.get(key)
      if (existing && existing.origin === 'llm') {
        counts.kept++
        continue
      }
      const places = this.#places(mode)
      const prepared = prepare(input, places, this.deps.neighborhoods)
      if (prepared.kind === 'answer') continue
      const { response } = await this.answer(input, 'prewarm', { skipCache: true })
      if (response.source === 'llm') counts.llm++
      else if (response.source === 'local') {
        this.deps.cache.set(key, response, 'local')
        counts.local++
      }
    }
    return counts
  }
}
