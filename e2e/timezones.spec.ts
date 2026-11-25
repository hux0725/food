import { formatShortDate, seattleToday } from '../shared/dates'
import { expect, openApp, test } from './fixtures'

/** The audience laptop or projector PC may be set to any timezone. The app must still use Seattle's date. */
for (const timezoneId of ['Asia/Tokyo', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/London']) {
  test.describe(`device timezone ${timezoneId}`, () => {
    test.use({ timezoneId })

    test('shows Seattle today and saves a plan for it', async ({ page }) => {
      const today = seattleToday()
      await openApp(page)
      await expect(page.getByTestId('plan-date-chip')).toContainText(formatShortDate(today))
      await page.getByTestId('place-card').first().locator('.plan-btn').click()
      await expect(page.getByTestId('schedule-date')).toHaveValue(today)
      await page.getByTestId('schedule-time').fill('23:30')
      await page.getByTestId('save-plan').click()
      await expect(page.getByTestId('confirmation')).toBeVisible()
      const plans = (await (await page.request.get('/api/plans')).json()).plans
      expect(plans).toMatchObject([{ date: today, time: '23:30' }])
    })
  })
}

test.describe('fixed clock: late evening in Seattle is already tomorrow elsewhere', () => {
  test.use({ timezoneId: 'Asia/Tokyo' })

  test('22:30 Seattle on Nov 24 (15:30 Nov 25 in Tokyo) → Nov 24, dinner', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-25T06:30:00Z'))
    await openApp(page)
    await expect(page.getByTestId('plan-date-chip')).toContainText('Nov 24')
    await page.getByTestId('open-assistant').click()
    await expect(page.getByTestId('weather')).toContainText(/dinner/i)
    await page.getByTestId('nav-calendar').click()
    await expect(page.getByTestId('calendar-month')).toContainText('November 2026')
    await expect(page.locator('[data-testid="calendar-day"].selected')).toHaveAttribute('data-date', '2026-11-24')
  })

  test('DST fall-back night (2026-11-01 01:30 PST) → Nov 1', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-01T09:30:00Z'))
    await openApp(page)
    await expect(page.getByTestId('plan-date-chip')).toContainText('Nov 1')
  })

  test('leap day 2028-02-29 renders in the calendar', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2028-02-29T20:00:00Z'))
    await openApp(page)
    await expect(page.getByTestId('plan-date-chip')).toContainText('Feb 29')
    await page.getByTestId('nav-calendar').click()
    await expect(page.locator('[data-testid="calendar-day"][data-date="2028-02-29"]')).toBeVisible()
    await expect(page.locator('[data-testid="calendar-day"][data-date="2028-02-30"]')).toHaveCount(0)
  })
})
