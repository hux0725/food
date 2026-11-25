import { test as base, expect, type Page } from '@playwright/test'
import { seattleToday } from '../shared/dates'

export const WEATHER_URL = 'https://api.open-meteo.com/**'

type Fixtures = {
  /** Console errors and uncaught page errors seen during the test. Asserted empty unless a test opts out. */
  consoleErrors: string[]
  allowConsoleErrors: boolean
}

export const test = base.extend<Fixtures>({
  allowConsoleErrors: [false, { option: true }],
  consoleErrors: async ({ page, allowConsoleErrors }, use) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    await use(errors)
    if (!allowConsoleErrors) expect(errors, 'console errors during the test').toEqual([])
  },
  page: async ({ page, request }, use) => {
    // Live weather by default so runs do not depend on the venue network; failure tests override this.
    await page.route(WEATHER_URL, (route) => route.fulfill({ json: { current: { temperature_2m: 49.6, weather_code: 61 } } }))
    // Clean slate for the single demo user.
    const plans = (await (await request.get('/api/plans')).json()).plans as Array<{ id: string }>
    for (const plan of plans) await request.delete(`/api/plans/${plan.id}`)
    const favorites = (await (await request.get('/api/favorites')).json()).favorites as Array<{ placeId: string }>
    for (const favorite of favorites) await request.delete(`/api/favorites/${favorite.placeId}`)
    await use(page)
  },
})

export { expect }

export const today = () => seattleToday()

/** A date a few days ahead in Seattle, as YYYY-MM-DD. */
export function daysAhead(days: number): string {
  const [y, m, d] = today().split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export async function openApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByTestId('result-count')).toContainText('68 PLACES')
}

export async function ask(page: Page, message: string) {
  if (await page.getByTestId('open-assistant').isVisible()) await page.getByTestId('open-assistant').click()
  const input = page.getByTestId('chat-input')
  await input.fill(message)
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('assistant-typing')).toHaveCount(0)
}

/** True if the page shows any text that would read as a failure to an audience. */
export async function visibleErrorText(page: Page): Promise<string | null> {
  const text = await page.locator('body').innerText()
  const match = text.match(/\b(error|exception|undefined|NaN|failed to fetch|stack|500|502|503|TypeError)\b/i)
  return match ? match[0] : null
}
