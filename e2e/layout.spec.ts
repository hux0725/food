import { expect, openApp, test } from './fixtures'

test.describe('filter chips', () => {
  test('every chip is wide enough for its label, so text never spills out of the bubble', async ({ page }) => {
    await openApp(page)
    const squeezed = await page.evaluate(() => {
      const bad: string[] = []
      for (const chip of document.querySelectorAll<HTMLElement>('.filters .chip')) {
        const label = chip.textContent?.trim() ?? ''
        // scrollWidth > clientWidth means the content is wider than the bubble
        if (chip.scrollWidth > chip.clientWidth + 1) bad.push(`${label}: content ${chip.scrollWidth}px in ${chip.clientWidth}px`)
      }
      return bad
    })
    expect(squeezed).toEqual([])
  })

  test('chips do not overlap each other and the neighborhood row scrolls to the last one', async ({ page }) => {
    await openApp(page)
    const row = page.getByTestId('neighborhoods')
    const overlaps = await row.evaluate((el) => {
      const rects = [...el.querySelectorAll<HTMLElement>('.chip')].map((c) => ({ text: c.textContent?.trim(), ...c.getBoundingClientRect().toJSON() }))
      const out: string[] = []
      for (let i = 1; i < rects.length; i++) if (rects[i].left < rects[i - 1].right - 0.5) out.push(`${rects[i - 1].text} / ${rects[i].text}`)
      return out
    })
    expect(overlaps).toEqual([])

    const last = row.locator('.chip').last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport({ ratio: 1 })
  })
})
