/**
 * A small interface in front of the LLM so the vendor can be swapped (or mocked in tests).
 */
export type LlmRequest = {
  system: string
  user: string
  maxTokens: number
  signal: AbortSignal
}

export type LlmResult = {
  text: string
  inputTokens: number
  outputTokens: number
}

export type LlmErrorKind = 'timeout' | 'auth' | 'rate_limited' | 'server' | 'network' | 'bad_response' | 'not_configured'

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly status?: number,
  ) {
    super(`LLM ${kind}${status ? ` (${status})` : ''}`)
  }

  /** Worth one retry: the next attempt may well succeed. */
  get transient(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'server' || this.kind === 'network'
  }
}

export interface LlmProvider {
  readonly name: string
  /** True when the provider has what it needs (key and model) to make a call. */
  readonly ready: boolean
  complete(request: LlmRequest): Promise<LlmResult>
}
