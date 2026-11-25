import { ask, daysAhead, expect, openApp, test } from './fixtures'

/** Runs in the mobile project only (see playwright.config.ts). */
test.describe('touch targets', () => {
  test('every visible control is at least 44×44 px on mobile', async ({ page }) => {
    await page.request.post('/api/plans', { data: { placeId: 'wolf', date: daysAhead(0), time: '19:00' } })
    await page.request.put('/api/favorites/canlis')
    const small: string[] = []
    const check = async (state: string) => {
      const found = await page.evaluate(() => {
        const out: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')) {
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          if (!rect.width || !rect.height || style.visibility === 'hidden' || el.closest('[aria-hidden=true]')) continue
          if (rect.width < 44 || rect.height < 44) {
            const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName
            out.push(`${label} ${Math.round(rect.width)}×${Math.round(rect.height)}`)
          }
        }
        return out
      })
      small.push(...found.map((f) => `${state}: ${f}`))
    }
    await openApp(page)
    await check('discover')
    await ask(page, 'pasta under $30')
    await check('assistant')
    await page.getByTestId('open-filters').click()
    await check('filters')
    await page.keyboard.press('Escape')
    await page.getByTestId('nav-calendar').click()
    await check('plans')
    await page.getByTestId('edit-plan').click()
    await check('plans-edit')
    await page.getByTestId('nav-heart').click()
    await check('saved')
    await page.getByTestId('nav-user').click()
    await check('profile')
    expect([...new Set(small)]).toEqual([])
  })
})
