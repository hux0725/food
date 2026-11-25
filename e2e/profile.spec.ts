import { daysAhead, expect, openApp, test } from './fixtures'

test.describe('profile preferences', () => {
  test('area, budget and travel can be edited on the profile and apply to Discover', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('nav-user').click()
    const profile = page.getByTestId('profile')

    // Area
    await expect(page.getByTestId('profile-area')).toHaveValue('Seattle, WA')
    await page.getByTestId('profile-area').selectOption('Ballard')

    // Budget
    await page.getByTestId('profile-budget').fill('20')
    await expect(page.getByTestId('profile-budget-clear')).toBeVisible()

    // Travel
    await profile.getByTestId('profile-mode-bike').click()
    await expect(profile.getByTestId('profile-mode-bike')).toHaveAttribute('aria-pressed', 'true')
    await expect(profile.getByTestId('profile-mode-walk')).toHaveAttribute('aria-pressed', 'false')

    await page.getByTestId('nav-home').click()
    await expect(page.getByTestId('result-count')).toContainText('IN BALLARD')
    await expect(page.getByRole('button', { name: /YOUR AREA Ballard/ })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Getting there' }).getByRole('button', { name: 'Bike' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Up to $20' })).toBeVisible()

    // Back on the profile the values are still shown, and the budget can be removed again.
    await page.getByTestId('nav-user').click()
    await expect(page.getByTestId('profile-area')).toHaveValue('Ballard')
    await expect(page.getByTestId('profile-budget')).toHaveValue('20')
    await page.getByTestId('profile-budget-clear').click()
    await expect(page.getByTestId('profile-budget')).toHaveValue('')
    await page.getByTestId('profile-area').selectOption('Seattle, WA')
    await page.getByTestId('nav-home').click()
    await expect(page.getByTestId('result-count')).toContainText('68 PLACES')
    await expect(page.getByRole('button', { name: 'Any budget' })).toBeVisible()
  })

  test('a custom area typed in Filters stays selectable on the profile', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('open-filters').click()
    await page.getByPlaceholder('City or neighborhood').fill('Pioneer Square')
    await page.getByTestId('apply-filters').click()
    await page.getByTestId('nav-user').click()
    await expect(page.getByTestId('profile-area')).toHaveValue('Pioneer Square')
    await expect(page.getByTestId('profile-area').locator('option:checked')).toHaveText('Pioneer Square')
  })

  test('saved places and dining plans open their pages', async ({ page }) => {
    await page.request.post('/api/plans', { data: { placeId: 'wolf', date: daysAhead(0), time: '19:00' } })
    await openApp(page)
    await page.getByTestId('nav-user').click()
    await expect(page.getByTestId('profile-plans-link')).toContainText('1 plan')
    await page.getByTestId('profile-plans-link').click()
    await expect(page.getByTestId('nav-calendar')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('nav-user').click()
    await page.getByTestId('profile-saved-link').click()
    await expect(page.getByTestId('nav-heart')).toHaveAttribute('aria-current', 'page')
  })
})
