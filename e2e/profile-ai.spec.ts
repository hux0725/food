import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, openApp, test } from './fixtures'

const status = (configured: boolean, keyPromptEnabled: boolean) => ({
  configured,
  provider: 'google',
  model: 'gemini-2.5-flash-lite',
  keyPromptEnabled,
  demoDebug: false,
})

async function mockStatus(page: Page, configured: boolean, keyPromptEnabled: boolean) {
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: status(configured, keyPromptEnabled) }))
}

test.describe('profile: AI assistant setup row', () => {
  test('is hidden on stage (key prompt off): the audience never sees setup messages', async ({ page }) => {
    await mockStatus(page, false, false)
    await openApp(page)
    await page.getByTestId('nav-user').click()
    await expect(page.getByTestId('profile')).toBeVisible()
    await expect(page.getByTestId('profile-ai')).toHaveCount(0)
    await expect(page.getByTestId('profile')).not.toContainText('API key')
  })

  test('without a key it offers "Add API key", opens the same dialog, and turns On after saving', async ({ page }) => {
    let configured = false
    await page.route('**/api/ai/status', (route) => route.fulfill({ json: status(configured, true) }))
    await page.route('**/api/ai/key', (route) => {
      configured = true
      return route.fulfill({ status: 200, json: { configured: true, verified: true, persisted: true } })
    })
    await openApp(page)
    await page.getByTestId('nav-user').click()

    const row = page.getByTestId('profile-ai')
    await expect(row).toContainText('Off: add API key')
    await expect(row).toContainText('basic keyword matching')
    const box = await row.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => v.id)).toEqual([])

    await row.click()
    const dialog = page.getByTestId('ai-key-prompt')
    await expect(dialog).toBeVisible()
    await page.getByTestId('ai-key-input').fill('test-google-key-0123456789abcdefghij')
    await page.getByTestId('ai-key-save').click()
    await expect(dialog).toHaveCount(0)

    await expect(page.getByTestId('profile-ai')).toContainText('On')
    await expect(page.getByTestId('profile-ai')).not.toContainText('add API key')
    // A configured key can't be replaced from the browser, so the row is information only.
    expect(await page.getByTestId('profile-ai').evaluate((el) => el.tagName)).toBe('DIV')
  })

  test('with a key it shows On', async ({ page }) => {
    await mockStatus(page, true, true)
    await openApp(page)
    await page.getByTestId('nav-user').click()
    await expect(page.getByTestId('profile-ai')).toContainText('On')
  })

  test('closing the dialog without a key keeps basic matching and the row stays', async ({ page }) => {
    await mockStatus(page, false, true)
    await openApp(page)
    await page.getByTestId('nav-user').click()
    await page.getByTestId('profile-ai').click()
    await page.getByTestId('ai-key-skip').click()
    await expect(page.getByTestId('ai-key-prompt')).toHaveCount(0)
    await expect(page.getByTestId('profile-ai')).toContainText('Off: add API key')
  })
})
