import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEMO_QUERIES, PREWARM_QUERIES, SUGGESTION_QUERIES } from '../../server/src/assistant/demoQueries'
import { localAnswer } from '../../shared/assistant-core'
import { toAssistantPlace } from '../../shared/places'
import { NEIGHBORHOODS, places } from '../../src/data/places'

const ROOT = resolve(import.meta.dirname, '../..')
const script = readFileSync(resolve(ROOT, 'DEMO_SCRIPT.md'), 'utf8')
const app = readFileSync(resolve(ROOT, 'src/App.tsx'), 'utf8')

describe('demo kit', () => {
  it('DEMO_SCRIPT.md lists every demo query exactly, in code formatting', () => {
    for (const query of DEMO_QUERIES) expect(script, query).toContain(`\`${query}\``)
  })

  it('every demo query returns three picks locally, except the "nothing fits" one', () => {
    const all = places.map((place) => toAssistantPlace(place, 'walk'))
    for (const message of DEMO_QUERIES) {
      const response = localAnswer({ message, mode: 'walk', neighborhood: null, cuisine: null, budget: null, mealMoment: 'dinner' }, all, NEIGHBORHOODS)
      if (message.includes('under $5')) expect(response.reply, message).toMatch(/^Nothing fits all of that\. Try /)
      else expect(response.rankedIds, message).toHaveLength(3)
    }
  })

  it('pre-warms the exact messages the suggestion chips send', () => {
    for (const query of SUGGESTION_QUERIES) {
      expect(app, query).toContain(`sendMessage('${query}')`)
      expect(PREWARM_QUERIES).toContain(query)
    }
  })
})
