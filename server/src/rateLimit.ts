/** In-memory sliding-window limiter, per key (client IP). Fine for a single-process demo server. */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>()

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Records a hit and returns whether it is within the limit. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < this.windowMs)
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.#hits.set(key, recent)
    if (this.#hits.size > 10_000) this.#hits.clear()
    return true
  }
}
