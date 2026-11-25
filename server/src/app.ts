import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify, { LogController, type FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import { NEIGHBORHOODS } from '../../src/data/places.js'
import { AssistantCache } from './assistant/cache.js'
import type { LlmProvider } from './assistant/provider.js'
import { AssistantService } from './assistant/service.js'
import { Db } from './db/index.js'
import { seedPlaces } from './db/seed.js'
import type { Env } from './env.js'
import { errorHandler, sendError } from './errors.js'
import { googleProvider, verifyGoogleKey, type KeyCheck } from './llm/google.js'
import { LlmKeyStore } from './llm/keyStore.js'
import { RateLimiter } from './rateLimit.js'
import { aiRoutes } from './routes/ai.js'
import { assistantRoutes } from './routes/assistant.js'
import { favoriteRoutes } from './routes/favorites.js'
import { healthRoutes } from './routes/health.js'
import { placeRoutes } from './routes/places.js'
import { planRoutes } from './routes/plans.js'

/** Fastify's default log controller writes two extra lines per request. We only want our single summary line. */
class QuietLogController extends LogController {
  override isLogDisabled(): boolean {
    return true
  }
}

const SERVER_DIR = resolve(import.meta.dirname, '..')

/** The Vite build output. In production the API server also serves the front end from here. */
export const DIST_DIR = resolve(SERVER_DIR, '../dist')

/** server/.env, where a key added from the app's setup prompt is saved. */
export const ENV_FILE = resolve(SERVER_DIR, '.env')

/** Relative paths in DB_PATH / CACHE_PATH are relative to server/, whatever the working directory. */
export function serverPath(path: string): string {
  return path === ':memory:' ? path : resolve(SERVER_DIR, path)
}

export type BuildOptions = {
  distDir?: string
  db?: Db
  keyStore?: LlmKeyStore
  verifyKey?: (apiKey: string) => Promise<KeyCheck>
  provider?: LlmProvider
  cache?: AssistantCache
  /** Clock for "today" checks on plans. */
  now?: () => Date
  llmTimeoutMs?: number
  /** LLM calls per client per minute before answers come from the cache or local matcher. */
  llmPerMinute?: number
  /** Assistant requests per client per minute before a friendly 429. */
  assistantPerMinute?: number
}

export type App = FastifyInstance & { assistant: AssistantService; db: Db }

/**
 * Builds the Fastify app without starting it. Tests can build it and call it directly.
 */
export async function buildApp(env: Env, options: BuildOptions = {}): Promise<App> {
  const production = env.NODE_ENV === 'production'
  const keyStore = options.keyStore ?? new LlmKeyStore(env.LLM_API_KEY, env.NODE_ENV === 'test' ? null : ENV_FILE)
  const verifyKey = options.verifyKey ?? verifyGoogleKey
  const provider = options.provider ?? googleProvider(keyStore, env.LLM_MODEL)
  const ownsDb = !options.db
  const db = options.db ?? new Db(serverPath(env.DB_PATH))
  seedPlaces(db)
  const cache = options.cache ?? new AssistantCache(serverPath(env.CACHE_PATH))

  const app = Fastify({
    logger:
      env.LOG_LEVEL === 'silent'
        ? false
        : {
            level: env.LOG_LEVEL,
            // Pretty logs while developing; plain JSON in production.
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } : undefined,
            // Never log request bodies or headers, so user messages and keys stay out of logs.
            serializers: {
              req: (request) => ({ method: request.method, url: request.url, requestId: request.id }),
            },
            redact: ['req.headers.authorization', 'req.headers["x-api-key"]', 'req.headers["x-goog-api-key"]', 'apiKey', '*.apiKey'],
          },
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 32 * 1024,
    trustProxy: production,
    logController: new QuietLogController(),
  }) as unknown as App

  const assistant = new AssistantService({
    db,
    provider,
    cache,
    llmLimiter: new RateLimiter(options.llmPerMinute ?? 15, 60_000),
    neighborhoods: [...NEIGHBORHOODS],
    log: app.log,
    timeoutMs: options.llmTimeoutMs,
  })
  app.decorate('assistant', assistant)
  app.decorate('db', db)

  // Log one line per finished request: method, path, status, and duration. Query strings are dropped.
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({ statusCode: reply.statusCode, responseTimeMs: Math.round(reply.elapsedTime) }, `${request.method} ${request.url.split('?')[0]}`)
  })
  if (ownsDb) app.addHook('onClose', async () => db.close())

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://api.open-meteo.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Only meaningful over HTTPS; hosts terminate TLS in front of us.
    hsts: production ? { maxAge: 15552000 } : false,
  })
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()')
  })

  // The Vite dev proxy makes /api same-origin, so CORS is only a fallback for the dev origin, and is off in production.
  if (env.NODE_ENV === 'development') {
    await app.register(fastifyCors, { origin: [env.DEV_ORIGIN], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] })
  }

  app.setErrorHandler(errorHandler)

  await app.register(healthRoutes, { prefix: '/api', db, provider })
  await app.register(placeRoutes, { prefix: '/api', db })
  await app.register(planRoutes, { prefix: '/api', db, now: options.now })
  await app.register(favoriteRoutes, { prefix: '/api', db })
  await app.register(assistantRoutes, {
    prefix: '/api',
    service: assistant,
    floodLimiter: new RateLimiter(options.assistantPerMinute ?? 40, 60_000),
    production,
  })
  await app.register(aiRoutes, { prefix: '/api', env, keyStore, provider, verifyKey })

  const distDir = options.distDir ?? DIST_DIR
  const serveFrontEnd = existsSync(resolve(distDir, 'index.html'))
  if (serveFrontEnd) {
    await app.register(fastifyStatic, {
      root: distDir,
      wildcard: false,
      setHeaders: (reply, filePath) => {
        // Hashed assets never change; everything else must be re-fetched so a redeploy shows up immediately.
        reply.header('Cache-Control', filePath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
  } else {
    app.log.info('No dist/ build found. Serving the API only (run `npm run build` at the repo root to serve the app too).')
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0]
    const isApi = path === '/api' || path.startsWith('/api/')
    const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(path)
    if (!isApi && !looksLikeFile && serveFrontEnd && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html')
    }
    return sendError(reply, request, 'NOT_FOUND', 404, `No route for ${request.method} ${path}.`)
  })

  return app
}
