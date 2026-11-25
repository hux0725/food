import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const DATA = resolve(import.meta.dirname, 'artifacts/e2e-data')
/** Set E2E_BASE_URL to run the suite against a deployed copy instead of a local production server. */
const external = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'artifacts/playwright/results',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright/report', open: 'never' }], ['junit', { outputFile: 'artifacts/playwright/junit.xml' }]],
  use: {
    baseURL: external ?? `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
  },
  projects: [
    { name: 'chromium-1440', testIgnore: /\.mobile\.spec\.ts$/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-1920', testIgnore: /\.mobile\.spec\.ts$/, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    {
      name: 'mobile-390',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    { name: 'webkit-1440', testIgnore: /\.mobile\.spec\.ts$/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: external
    ? undefined
    : {
        // Production mode, throwaway database, no LLM key: the same fallback path the audience would get if the model is down.
        command: `rm -rf "${DATA}" && npm start`,
        url: `http://127.0.0.1:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
        env: {
          PORT: String(PORT),
          HOST: '127.0.0.1',
          DB_PATH: `${DATA}/app.db`,
          CACHE_PATH: `${DATA}/assistant-cache.json`,
          LLM_API_KEY: '',
          // Stage settings, whatever is in server/.env: the audience never sees the "add an API key" prompt.
          AI_KEY_PROMPT: 'off',
          LOG_LEVEL: 'warn',
          DEMO_DEBUG: 'false',
        },
      },
})
