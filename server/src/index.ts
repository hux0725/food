import { buildApp } from './app.js'
import { PREWARM_QUERIES } from './assistant/demoQueries.js'
import { EnvError, loadEnv } from './env.js'

const SHUTDOWN_TIMEOUT_MS = 10_000
const CONNECTION_GRACE_MS = 1_500

async function main() {
  let env
  try {
    env = loadEnv()
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`\n${error.message}\n`)
      process.exit(1)
    }
    throw error
  }

  const app = await buildApp(env)

  if (!env.LLM_API_KEY) {
    app.log.warn('LLM_API_KEY is not set. The assistant will answer from the demo cache and the local matcher.')
  }

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `\nPort ${env.PORT} is already in use. Another copy of the server is probably running.\n` +
          `Stop it (macOS/Linux: lsof -ti tcp:${env.PORT} | xargs kill) or start on another port: PORT=3002 npm start\n`,
      )
      process.exit(1)
    }
    throw error
  }

  // Fill the demo cache in the background; the server is already answering.
  void app.assistant
    .prewarm(PREWARM_QUERIES)
    .then((counts) => app.log.info({ prewarm: counts }, 'demo cache ready'))
    .catch((error: unknown) => app.log.warn({ err: error }, 'demo cache prewarm failed; answers fall back to the local matcher'))

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info(`${signal} received, finishing open requests and shutting down.`)
    const force = setTimeout(() => {
      app.log.error('Shutdown took too long, exiting anyway.')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    force.unref()
    // Open browser tabs hold keep-alive connections that would make close() wait for the full
    // timeout. Give real requests a moment to finish, then drop whatever connections remain.
    const dropIdle = setTimeout(() => app.server.closeAllConnections(), CONNECTION_GRACE_MS)
    dropIdle.unref()
    try {
      await app.close()
      process.exit(0)
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown')
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('Server failed to start:', error)
  if (error instanceof Error && /not a database|database disk image|SQLITE|unable to open database/i.test(error.message)) {
    console.error(
      `\nThe database file (DB_PATH=${process.env.DB_PATH ?? 'data/bite.db'}) cannot be opened.\n` +
        'Move it aside (it is recreated on start, without saved plans or favorites) or point DB_PATH at another file.\n',
    )
  }
  process.exit(1)
})
