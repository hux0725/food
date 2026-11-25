import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * Holds the LLM API key on the server. The key can be set once from the app's setup prompt,
 * but it is never returned to any client.
 */
export class LlmKeyStore {
  #key: string | undefined
  #rejected = false

  constructor(
    initialKey: string | undefined,
    /** File the key is written to so it survives a restart. null keeps it in memory only. */
    private readonly envFilePath: string | null,
  ) {
    this.#key = initialKey
  }

  /** A key is present and the provider has not rejected it since startup. */
  get configured(): boolean {
    return Boolean(this.#key) && !this.#rejected
  }

  get key(): string | undefined {
    return this.#rejected ? undefined : this.#key
  }

  /** Stores the key in memory and in the env file. Returns whether the file write succeeded. */
  save(key: string): { persisted: boolean } {
    this.#key = key
    this.#rejected = false
    if (!this.envFilePath) return { persisted: false }
    try {
      writeEnvValue(this.envFilePath, 'LLM_API_KEY', key)
      return { persisted: true }
    } catch {
      return { persisted: false }
    }
  }

  /**
   * The provider answered 401/403. Stop using the key until restart or a new key is saved,
   * so every request falls back instantly instead of waiting on a doomed call. The env file is left alone.
   */
  markRejected(): void {
    this.#rejected = true
  }
}

function writeEnvValue(path: string, name: string, value: string): void {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const line = `${name}=${value}`
  const pattern = new RegExp(`^${name}=.*$`, 'm')
  const next = pattern.test(current)
    ? current.replace(pattern, () => line)
    : `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${line}\n`
  const temp = `${path}.tmp`
  writeFileSync(temp, next, { mode: 0o600 })
  renameSync(temp, path)
}
