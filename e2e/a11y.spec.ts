import AxeBuilder from '@axe-core/playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Locator, Page } from '@playwright/test'
import { ask, daysAhead, expect, openApp, test } from './fixtures'

const OUT = 'artifacts/a11y'

async function audit(page: Page, name: string, project: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/${project}-${name}.json`, JSON.stringify({ violations: results.violations, passes: results.passes.length }, null, 2))
  const serious = results.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  expect(serious, `${name}: critical/serious axe violations`).toEqual([])
}

test.describe('axe: zero critical or serious violations', () => {
  test('every tab, the assistant, and every dialog', async ({ page }, info) => {
    const project = info.project.name
    await page.request.put('/api/favorites/canlis')
    await page.request.post('/api/plans', { data: { placeId: 'wolf', date: daysAhead(0), time: '19:00' } })
    await openApp(page)
    await audit(page, 'discover', project)

    await ask(page, 'pasta under $30')
    await expect(page.getByTestId('chat-pick')).toHaveCount(3)
    await audit(page, 'assistant', project)

    await page.getByTestId('open-filters').click()
    await expect(page.getByTestId('filter-sheet')).toBeVisible()
    await audit(page, 'filters', project)
    await page.keyboard.press('Escape')

    await page.getByTestId('chat-pick').first().locator('.chat-choice-open').click()
    await expect(page.getByTestId('details')).toBeVisible()
    await audit(page, 'details', project)
    await page.getByTestId('details-plan').click()
    await expect(page.getByTestId('schedule')).toBeVisible()
    await audit(page, 'schedule', project)
    await page.keyboard.press('Escape')

    await page.getByTestId('nav-calendar').click()
    await expect(page.getByTestId('planned-card')).toHaveCount(1)
    await audit(page, 'plans', project)
    await page.getByTestId('edit-plan').click()
    await audit(page, 'plans-edit', project)

    await page.getByTestId('nav-heart').click()
    await expect(page.getByTestId('saved-row')).toHaveCount(1)
    await audit(page, 'saved', project)

    await page.getByTestId('nav-user').click()
    await audit(page, 'profile', project)
  })
})

/** Safari moves focus only between text fields on Tab; Option+Tab reaches every control. */
/** Derived from the page under test each time, so there is no shared state between tests. */
const tabKey = (page: Page) => (page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab')

async function tabTo(page: Page, target: Locator, maxPresses = 80) {
  const key = tabKey(page)
  const handle = await target.elementHandle()
  for (let i = 0; i < maxPresses; i++) {
    if (await page.evaluate((el) => document.activeElement === el, handle)) return
    await page.keyboard.press(key)
  }
  throw new Error(`could not reach ${target} with ${key}`)
}

test.describe('keyboard only', () => {
  test('ask the assistant and save a plan without a mouse', async ({ page }) => {
    await openApp(page)
    await tabTo(page, page.getByTestId('open-assistant'))
    await page.keyboard.press('Enter')
    await tabTo(page, page.getByTestId('chat-input'))
    await page.keyboard.type('cheap ramen near Capitol Hill')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('chat-pick')).toHaveCount(3)

    await tabTo(page, page.getByTestId('chat-pick-plan').first())
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('schedule')).toBeVisible()
    // Focus moves into the dialog, onto the time field, which starts with a suggested time.
    const time = page.getByTestId('schedule-time')
    await expect(time).toBeFocused()
    const suggested = await time.inputValue()
    expect(['09:00', '12:30', '19:00']).toContain(suggested)
    // Arrow keys change the focused segment the same way in Chrome and Safari.
    await page.keyboard.press('ArrowUp')
    const chosen = await time.inputValue()
    expect(chosen).not.toBe(suggested)
    await tabTo(page, page.getByTestId('save-plan'), 20)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('confirmation')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('confirmation')).toHaveCount(0)

    const plans = (await (await page.request.get('/api/plans')).json()).plans
    expect(plans).toHaveLength(1)
    expect(plans[0].time).toBe(chosen)
  })

  test('focus is trapped in dialogs and returns to the opener on Escape', async ({ page }) => {
    await openApp(page)
    const opener = page.getByTestId('open-filters')
    await opener.focus()
    await page.keyboard.press('Enter')
    const sheet = page.getByTestId('filter-sheet')
    await expect(sheet).toBeVisible()
    const key = tabKey(page)
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key)
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})
