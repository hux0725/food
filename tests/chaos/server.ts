import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

const SERVER_DIR = resolve(import.meta.dirname, '../../server')

export type RunningServer = {
  url: string
  proc: ChildProcess
  logs: () => string
  stop: (signal?: NodeJS.Signals) => Promise<number | null>
}

/** Starts the real production server (`node --import tsx src/index.ts`) without reading server/.env. */
export function startServer(env: Record<string, string>, options: { waitForHealth?: boolean } = {}): Promise<RunningServer> {
  const port = env.PORT
  const url = `http://127.0.0.1:${port}`
  let output = ''
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'production', HOST: '127.0.0.1', LOG_LEVEL: 'info', LLM_API_KEY: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout!.on('data', (chunk) => (output += chunk))
  proc.stderr!.on('data', (chunk) => (output += chunk))
  const exited = new Promise<number | null>((resolveExit) => proc.on('exit', (code) => resolveExit(code)))

  const server: RunningServer = {
    url,
    proc,
    logs: () => output,
    stop: async (signal = 'SIGTERM') => {
      if (proc.exitCode !== null) return proc.exitCode
      proc.kill(signal)
      return exited
    },
  }
  if (options.waitForHealth === false) return Promise.resolve(server)

  return new Promise((resolveStart, rejectStart) => {
    const deadline = Date.now() + 20_000
    const poll = async () => {
      if (proc.exitCode !== null) return rejectStart(new Error(`server exited with ${proc.exitCode}:\n${output}`))
      try {
        const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) })
        if (res.status === 200) return resolveStart(server)
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) return rejectStart(new Error(`server did not become healthy:\n${output}`))
      setTimeout(poll, 150)
    }
    void poll()
  })
}

/** Waits for a process started with waitForHealth=false to exit, up to a limit. */
export function waitForExit(server: RunningServer, ms = 15_000): Promise<number | null> {
  if (server.proc.exitCode !== null) return Promise.resolve(server.proc.exitCode)
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(null), ms)
    server.proc.on('exit', (code) => {
      clearTimeout(timer)
      resolveExit(code)
    })
  })
}
