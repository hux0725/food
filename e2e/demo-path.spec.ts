import { mkdirSync } from 'node:fs'
import { DEMO_QUERIES } from '../server/src/assistant/demoQueries'
import { ask, daysAhead, expect, openApp, test, visibleErrorText } from './fixtures'

test.describe('demo path', () => {
  test('discover → assistant → details → plan → edit → save → reload persists', async ({ page, consoleErrors }, info) => {
    const shots = `artifacts/screenshots/${info.project.name}`
    mkdirSync(shots, { recursive: true })
    await openApp(page)
    await expect(page.getByTestId('place-card')).toHaveCount(68)
    await page.screenshot({ path: `${shots}/01-discover.png` })

    // Assistant
    await ask(page, 'pasta under $30')
    const picks = page.getByTestId('chat-pick')
    await expect(picks).toHaveCount(3)
    await expect(page.getByTestId('chat-log')).toContainText('three strong matches for italian at or under $30')
    await expect(page.getByTestId('assistant-source')).toHaveCount(0)
    await page.screenshot({ path: `${shots}/02-assistant.png` })

    // Details, then plan from details
    const firstName = (await picks.first().locator('strong').first().innerText()).trim()
    await picks.first().locator('.chat-choice-open').click()
    const details = page.getByTestId('details')
    await expect(details).toBeVisible()
    await expect(details).toContainText(firstName)
    await page.screenshot({ path: `${shots}/03-details.png` })
    await page.getByTestId('details-plan').click()

    const schedule = page.getByTestId('schedule')
    await expect(schedule).toBeVisible()
    const planDate = daysAhead(3)
    await page.getByTestId('schedule-date').fill(planDate)
    await page.getByTestId('schedule-time').fill('19:30')
    await page.screenshot({ path: `${shots}/04-schedule.png` })
    await page.getByTestId('save-plan').click()
    await expect(page.getByTestId('confirmation')).toBeVisible()
    await expect(page.getByTestId('confirmation')).toContainText('No table reservation was made.')
    await page.getByTestId('go-to-calendar').click()

    // Plans tab
    const card = page.getByTestId('planned-card')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(firstName)
    await expect(card).toContainText('7:30 PM')
    await page.screenshot({ path: `${shots}/05-plans.png` })

    // Edit time
    await page.getByTestId('edit-plan').click()
    await page.getByTestId('edit-time').fill('18:15')
    await page.getByTestId('edit-save').click()
    await expect(card).toContainText('6:15 PM')

    // Save a place from Discover
    await page.getByTestId('nav-home').click()
    const heart = page.getByTestId('place-card').first().getByTestId('save-toggle')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('nav-heart').click()
    await expect(page.getByTestId('saved-row')).toHaveCount(1)
    await page.screenshot({ path: `${shots}/06-saved.png` })
    await page.getByTestId('nav-user').click()
    await expect(page.getByTestId('profile')).toContainText('1 plan')
    await page.screenshot({ path: `${shots}/07-profile.png` })

    // Everything survives a reload (it is in the database, not the tab)
    await page.reload()
    await page.getByTestId('nav-calendar').click()
    await expect(page.getByTestId('upcoming-plan')).toHaveCount(1)
    await expect(page.getByTestId('upcoming-plan')).toContainText(firstName)
    await page.getByTestId('upcoming-plan').click()
    await expect(page.getByTestId('planned-card')).toHaveCount(1)
    await expect(page.getByTestId('planned-card')).toContainText('6:15 PM')
    await page.getByTestId('nav-heart').click()
    await expect(page.getByTestId('saved-row')).toHaveCount(1)

    // Remove the plan
    await page.getByTestId('nav-calendar').click()
    await page.getByTestId('edit-plan').click()
    await page.getByTestId('edit-remove').click()
    await expect(page.getByTestId('planned-card')).toHaveCount(0)

    expect(await visibleErrorText(page)).toBeNull()
    expect(consoleErrors).toEqual([])
  })

  test('every demo-script query answers with picks or an honest "nothing fits"', async ({ page }) => {
    await openApp(page)
    for (const query of DEMO_QUERIES) {
      await ask(page, query)
      const reply = page.getByTestId('chat-log').locator('.message').last()
      if (query.startsWith('sushi under $5')) {
        await expect(reply).toContainText('Nothing fits all of that.')
      } else {
        await expect(page.getByTestId('chat-pick')).toHaveCount(3)
      }
    }
    expect(await visibleErrorText(page)).toBeNull()
  })

  test('the send button cannot double-send', async ({ page }) => {
    await openApp(page)
    let calls = 0
    await page.route('**/api/assistant', async (route) => {
      calls++
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    await page.getByTestId('open-assistant').click()
    await page.getByTestId('chat-input').fill('ramen')
    await page.getByTestId('chat-input').press('Enter')
    await page.getByTestId('chat-input').press('Enter')
    await expect(page.getByTestId('chat-send')).toBeDisabled()
    await expect(page.getByTestId('assistant-typing')).toBeVisible()
    await expect(page.getByTestId('assistant-typing')).toHaveCount(0)
    expect(calls).toBe(1)
    await expect(page.getByTestId('chat-log').locator('.message')).toHaveCount(2)
  })

  test('a duplicate plan for the same day shows a clear message', async ({ page }) => {
    await openApp(page)
    const date = daysAhead(2)
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByTestId('place-card').first().locator('.plan-btn').click()
      await page.getByTestId('schedule-date').fill(date)
      await page.getByTestId('schedule-time').fill('12:00')
      await page.getByTestId('save-plan').click()
      if (attempt === 0) {
        await expect(page.getByTestId('confirmation')).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
    await expect(page.getByTestId('schedule-error')).toHaveText('That restaurant is already planned for that day. Pick another date.')
  })

  test('the honesty labels are on screen', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('body')).toContainText('Ratings and waits are sample data')
    await expect(page.locator('body')).toContainText('photos are cuisine stand-ins')
    await ask(page, 'pizza')
    await expect(page.getByTestId('chat-results')).toContainText('Travel and wait times are estimates, not live traffic.')
  })
})
