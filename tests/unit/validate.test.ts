import { describe, expect, it } from 'vitest'
import { MAX_REASON_CHARS, factualReason } from '../../shared/assistant-core'
import { toAssistantPlace } from '../../shared/places'
import { groundPicks, parseModelOutput } from '../../server/src/assistant/validate'
import { places } from '../../src/data/places'

const candidates = places.slice(0, 6).map((place) => toAssistantPlace(place, 'walk'))
const [a, b, c, d] = candidates
const limits = { budget: null, maxMinutes: null }

describe('model output parsing', () => {
  it('accepts valid JSON, including inside code fences or prose', () => {
    const json = JSON.stringify({ status: 'ok', picks: [{ placeId: a.id, reason: 'Great.' }] })
    expect(parseModelOutput(json)?.picks).toHaveLength(1)
    expect(parseModelOutput('```json\n' + json + '\n```')?.picks).toHaveLength(1)
    expect(parseModelOutput('Here you go: ' + json + ' Enjoy!')?.picks).toHaveLength(1)
  })

  it('rejects malformed output as a whole', () => {
    expect(parseModelOutput('')).toBeNull()
    expect(parseModelOutput('Sorry, I cannot help.')).toBeNull()
    expect(parseModelOutput('{"picks": [ {"placeId": ')).toBeNull()
    expect(parseModelOutput('{"picks": "La Medusa"}')).toBeNull()
    expect(parseModelOutput('{"status": "maybe", "picks": []}')).toBeNull()
  })

  it('treats missing status as ok and ignores extra fields', () => {
    const out = parseModelOutput(JSON.stringify({ picks: [{ placeId: a.id, reason: 'x', score: 9 }], debug: true }))
    expect(out).toEqual({ status: 'ok', picks: [{ placeId: a.id, reason: 'x' }] })
  })

  it('drops individual malformed picks (missing or wrong-typed fields) and keeps the good ones', () => {
    const out = parseModelOutput(
      JSON.stringify({ picks: [{ placeId: a.id }, { reason: 'no id' }, { placeId: 42, reason: 'x' }, null, 'b', { placeId: b.id, reason: 'ok' }] }),
    )
    expect(out?.picks).toEqual([{ placeId: b.id, reason: 'ok' }])
  })
})

describe('grounding picks against the candidates', () => {
  it('drops hallucinated and duplicate ids and keeps the model order', () => {
    const out = groundPicks(
      { status: 'ok', picks: [{ placeId: 'made-up', reason: 'x' }, { placeId: c.id, reason: 'Nice.' }, { placeId: c.id, reason: 'again' }, { placeId: a.id, reason: 'Good.' }] },
      candidates,
      limits,
      'walk',
    )
    expect(out.ranked.map((p) => p.id)).toEqual([c.id, a.id])
    expect(out.dropped).toBe(2)
  })

  it('returns at most 3 picks', () => {
    const out = groundPicks({ status: 'ok', picks: [a, b, c, d].map((p) => ({ placeId: p.id, reason: 'Nice.' })) }, candidates, limits, 'walk')
    expect(out.ranked).toHaveLength(3)
  })

  it('caps long reasons at 140 characters', () => {
    const out = groundPicks({ status: 'ok', picks: [{ placeId: a.id, reason: 'Lovely room and a warm welcome. '.repeat(20) }] }, candidates, limits, 'walk')
    expect(out.reasons[a.id].length).toBeLessThanOrEqual(MAX_REASON_CHARS)
  })

  it('replaces reasons that misstate price, time or hours with a factual one', () => {
    const out = groundPicks(
      {
        status: 'ok',
        picks: [
          { placeId: a.id, reason: 'Only $1 per person.' },
          { placeId: b.id, reason: 'Open until 3am.' },
          { placeId: c.id, reason: `About ${c.travelMinutes} min walk, cozy.` },
        ],
      },
      candidates,
      limits,
      'walk',
    )
    expect(out.reasons[a.id]).toBe(factualReason(a, 'walk'))
    expect(out.reasons[b.id]).toBe(factualReason(b, 'walk'))
    expect(out.reasons[c.id]).toBe(`About ${c.travelMinutes} min walk, cozy.`)
    expect(out.rewritten).toBe(2)
  })

  it('replaces empty reasons', () => {
    const out = groundPicks({ status: 'ok', picks: [{ placeId: a.id, reason: '   ' }] }, candidates, limits, 'walk')
    expect(out.reasons[a.id]).toBe(factualReason(a, 'walk'))
  })
})
