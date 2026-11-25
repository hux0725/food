import { WEATHER_URL, ask, daysAhead, expect, openApp, test, visibleErrorText } from './fixtures'

/** Browsers log failed requests ("Failed to load resource") on their own; anything else is a real error. */
const realErrors = (errors: string[]) => errors.filter((e) => !/Failed to load resource|net::ERR_|status of 5\d\d|status of 4\d\d/.test(e))

test.describe('failure injection: the audience never sees an error', () => {
  test.use({ allowConsoleErrors: true })

  for (const [name, handler] of [
    ['server error (500)', (route) => route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'boom' } } })],
    ['network down', (route) => route.abort('internetdisconnected')],
    ['malformed JSON', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"reply": "Here' })],
    ['made-up restaurant ids', (route) => route.fulfill({ json: { reply: 'Try Olive Garden', preference: null, neighborhood: null, maxTravelMinutes: null, maxBudget: null, rankedIds: ['olive-garden'], reasons: {}, source: 'llm' } })],
    ['rate limited (429)', (route) => route.fulfill({ status: 429, json: { error: { code: 'RATE_LIMITED', message: 'Lots of questions at once.' } } })],
  ] as const) {
    test(`assistant ${name} → local answer`, async ({ page, consoleErrors }) => {
      await openApp(page)
      await page.route('**/api/assistant', handler)
      await ask(page, 'pasta under $30')
      await expect(page.getByTestId('chat-pick')).toHaveCount(3)
      await expect(page.getByTestId('chat-log')).toContainText('three strong matches')
      await expect(page.getByTestId('chat-log')).not.toContainText(/olive garden|boom|error/i)
      expect(await visibleErrorText(page)).toBeNull()
      expect(realErrors(consoleErrors)).toEqual([])
    })
  }

  test('assistant hangs → typing indicator, then a local answer within the client timeout', async ({ page, consoleErrors }) => {
    await openApp(page)
    await page.route('**/api/assistant', () => {
      /* never answers */
    })
    await page.getByTestId('open-assistant').click()
    await page.getByTestId('chat-input').fill('cheap ramen near Capitol Hill')
    const started = Date.now()
    await page.getByTestId('chat-send').click()
    await expect(page.getByTestId('assistant-typing')).toBeVisible()
    await expect(page.getByTestId('chat-pick').first()).toBeVisible({ timeout: 12_000 })
    expect(Date.now() - started).toBeLessThan(11_000)
    expect(realErrors(consoleErrors)).toEqual([])
  })

  test('whole API down after load → list and assistant still work', async ({ page, consoleErrors }) => {
    await openApp(page)
    await page.route('**/api/**', (route) => route.abort('connectionrefused'))
    await expect(page.getByTestId('place-card')).toHaveCount(68)
    await ask(page, 'dumplings in the International District')
    await expect(page.getByTestId('chat-pick')).toHaveCount(3)
    expect(await visibleErrorText(page)).toBeNull()
    expect(realErrors(consoleErrors)).toEqual([])
  })

  test('weather service down → labeled SIMULATED; weather up → live, no label', async ({ page }) => {
    await page.unroute(WEATHER_URL)
    await page.route(WEATHER_URL, (route) => route.abort('internetdisconnected'))
    await openApp(page)
    await page.getByTestId('open-assistant').click()
    await expect(page.getByTestId('weather')).toContainText('SIMULATED')

    await page.unroute(WEATHER_URL)
    await page.route(WEATHER_URL, (route) => route.fulfill({ json: { current: { temperature_2m: 49.6, weather_code: 61 } } }))
    await page.reload()
    await page.getByTestId('open-assistant').click()
    await expect(page.getByTestId('weather')).toContainText('Rain · 50°F')
    await expect(page.getByTestId('weather')).not.toContainText('SIMULATED')
  })

  test('weather service slow (>3 s) → SIMULATED, no hang', async ({ page }) => {
    await page.unroute(WEATHER_URL)
    await page.route(WEATHER_URL, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000))
      await route.fulfill({ json: {} }).catch(() => undefined)
    })
    await openApp(page)
    await page.getByTestId('open-assistant').click()
    await expect(page.getByTestId('weather')).toContainText('SIMULATED')
    await ask(page, 'pizza')
    await expect(page.getByTestId('chat-pick').first()).toBeVisible()
  })

  test('plans fail to load → friendly message and a working retry', async ({ page }) => {
    let fail = true
    await page.route('**/api/plans', (route) => (fail && route.request().method() === 'GET' ? route.fulfill({ status: 503, json: {} }) : route.continue()))
    await openApp(page)
    await page.getByTestId('nav-calendar').click()
    await expect(page.getByTestId('plans-error')).toContainText("Couldn't load your plans")
    fail = false
    await page.getByTestId('plans-error').getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('plans-error')).toHaveCount(0)
  })

  test('saving a plan fails → message in the dialog, nothing half-saved', async ({ page }) => {
    await openApp(page)
    await page.route('**/api/plans', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'x' } } }) : route.continue()))
    await page.getByTestId('place-card').first().locator('.plan-btn').click()
    await page.getByTestId('schedule-date').fill(daysAhead(1))
    await page.getByTestId('schedule-time').fill('19:00')
    await page.getByTestId('save-plan').click()
    await expect(page.getByTestId('schedule-error')).toBeVisible()
    await expect(page.getByTestId('schedule-error')).not.toContainText(/500|internal|undefined/i)
    await expect(page.getByTestId('schedule')).toBeVisible()
    await expect(page.getByTestId('save-plan')).toBeEnabled()
  })

  test('saving a favorite fails → heart rolls back with a message', async ({ page }) => {
    await openApp(page)
    await page.route('**/api/favorites/**', (route) => route.fulfill({ status: 500, json: {} }))
    const heart = page.getByTestId('place-card').first().getByTestId('save-toggle')
    await heart.click()
    await expect(page.getByTestId('saved-toast')).toBeVisible()
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
  })

  test('location permission denied → friendly note, list unchanged', async ({ page, context }) => {
    await context.clearPermissions()
    await openApp(page)
    await page.getByTestId('open-assistant').click()
    await page.getByTestId('use-location').click()
    await expect(page.getByTestId('location-note')).toBeVisible()
    await expect(page.getByTestId('location-note')).not.toContainText(/error|denied by/i)
    await expect(page.getByTestId('place-card')).toHaveCount(68)
  })

  test('location granted → sorted by distance with a visible note', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 47.6687, longitude: -122.3843 }) // Ballard
    await openApp(page)
    await page.getByTestId('open-assistant').click()
    await page.getByTestId('use-location').click()
    await expect(page.getByTestId('location-note')).toContainText('Sorted by distance')
    await expect(page.getByTestId('place-card').first()).toHaveAttribute('data-place-id', /.+/)
    const first = await page.getByTestId('place-card').first().getAttribute('data-place-id')
    const res = await page.request.get(`/api/places/${first}`)
    expect((await res.json()).place.neighborhood).toMatch(/Ballard|Fremont/)
  })

  test('a render crash shows the friendly reload card, not a blank page', async ({ page }) => {
    await page.addInitScript(() => {
      Intl.DateTimeFormat.prototype.formatToParts = () => {
        throw new Error('injected render failure')
      }
    })
    await page.goto('/')
    const card = page.getByTestId('error-boundary')
    await expect(card).toBeVisible()
    await expect(card).toContainText("Let's reload that.")
    await expect(card.getByRole('button', { name: 'Reload the app' })).toBeVisible()
  })

  test('markup in a chat message is shown as text, never run', async ({ page }) => {
    await openApp(page)
    let alerted = false
    page.on('dialog', async (dialog) => {
      alerted = true
      await dialog.dismiss()
    })
    await ask(page, '<img src=x onerror="alert(1)"> pizza <script>alert(2)</script>')
    await expect(page.getByTestId('chat-log').getByTestId('user-message')).toContainText('<img src=x onerror="alert(1)">')
    expect(await page.getByTestId('chat-log').locator('img, script').count()).toBe(0)
    expect(alerted).toBe(false)
  })

  test('deep links and unknown paths load the app; unknown API paths return JSON', async ({ page, request }) => {
    await openApp(page, '/some/old/link')
    const api = await request.get('/api/does-not-exist')
    expect(api.status()).toBe(404)
    expect((await api.json()).error.code).toBe('NOT_FOUND')
  })
})
