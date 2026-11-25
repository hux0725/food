import { z } from 'zod'

const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .refine((value) => value === undefined || (value.length >= 20 && !/\s/.test(value)), {
    message: 'looks malformed (too short or contains spaces). Paste the full key, or leave it empty to run without the live assistant.',
  })

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional()

const flag = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : ['1', 'true', 'on', 'yes'].includes(value)))

/**
 * All server configuration comes from environment variables.
 * Parsed once at startup. If something is wrong, the server exits with a readable message.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3001),
    HOST: z.string().min(1).optional(),
    DB_PATH: z.string().min(1).default('./data/bite.db'),
    CACHE_PATH: z.string().min(1).default('./data/assistant-cache.json'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LLM_PROVIDER: z.enum(['google']).default('google'),
    LLM_MODEL: optionalText,
    LLM_API_KEY: optionalSecret,
    /** Show the assistant's answer source (llm / cache / local) in the UI. */
    DEMO_DEBUG: flag,
    /** Show the in-app "add an API key" prompt. Defaults to on in development, off in production. */
    AI_KEY_PROMPT: flag,
    /** Origin allowed by CORS in development (Vite dev server). Never used in production. */
    DEV_ORIGIN: z.string().default('http://localhost:5173'),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_API_KEY && !env.LLM_MODEL) {
      ctx.addIssue({ code: 'custom', path: ['LLM_MODEL'], message: 'is required when LLM_API_KEY is set (for example gemini-2.5-flash-lite)' })
    }
  })

export type Env = Omit<z.infer<typeof envSchema>, 'HOST' | 'DEMO_DEBUG' | 'AI_KEY_PROMPT'> & {
  HOST: string
  DEMO_DEBUG: boolean
  AI_KEY_PROMPT: boolean
}

export class EnvError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new EnvError(`Invalid server configuration. Check server/.env (see server/.env.example):\n${lines.join('\n')}`)
  }
  const env = result.data
  const production = env.NODE_ENV === 'production'
  return {
    ...env,
    // Hosting platforms route traffic to 0.0.0.0. Locally we stay on loopback so the API is not exposed to the network.
    HOST: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    DEMO_DEBUG: env.DEMO_DEBUG ?? false,
    AI_KEY_PROMPT: env.AI_KEY_PROMPT ?? !production,
  }
}
