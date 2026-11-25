import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { haversineMiles, travelMinutes } from '../../shared/travel'
import { NEIGHBORHOODS, places } from '../../src/data/places'

const ROOT = resolve(import.meta.dirname, '../..')

describe('travel estimates', () => {
  it('gives a finite, positive whole number for every place in every mode', () => {
    for (const place of places) {
      for (const mode of ['walk', 'bike', 'car'] as const) {
        const minutes = travelMinutes(place.miles, mode)
        expect(Number.isInteger(minutes), `${place.id} ${mode}`).toBe(true)
        expect(minutes).toBeGreaterThan(0)
        expect(minutes).toBeLessThan(300)
      }
      expect(travelMinutes(place.miles, 'walk')).toBeGreaterThanOrEqual(travelMinutes(place.miles, 'bike'))
    }
  })

  it('never returns NaN or Infinity for bad input', () => {
    for (const miles of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const mode of ['walk', 'bike', 'car'] as const) expect(Number.isFinite(travelMinutes(miles, mode))).toBe(true)
    }
  })

  it('computes straight-line distance', () => {
    const pike = { lat: 47.6097, lon: -122.3422 }
    expect(haversineMiles(pike, pike)).toBe(0)
    const ballard = { lat: 47.6687, lon: -122.3843 }
    expect(haversineMiles(pike, ballard)).toBeGreaterThan(4)
    expect(haversineMiles(pike, ballard)).toBeLessThan(5)
  })
})

describe('dataset', () => {
  it('has 68 places with unique ids and unique names', () => {
    expect(places).toHaveLength(68)
    expect(new Set(places.map((p) => p.id)).size).toBe(68)
    expect(new Set(places.map((p) => p.name.toLowerCase())).size).toBe(68)
  })

  it('has valid fields, photos on disk, coordinates in Seattle, and consistent price tiers', () => {
    const tiers: Record<string, [number, number]> = { $: [1, 20], $$: [15, 40], $$$: [30, 75], $$$$: [60, 400] }
    for (const p of places) {
      expect(NEIGHBORHOODS).toContain(p.neighborhood)
      expect(existsSync(resolve(ROOT, 'public', `.${p.image}`)), p.image).toBe(true)
      expect(p.lat).toBeGreaterThan(47.48)
      expect(p.lat).toBeLessThan(47.74)
      expect(p.lon).toBeGreaterThan(-122.46)
      expect(p.lon).toBeLessThan(-122.22)
      const [lo, hi] = tiers[p.price]
      expect(p.serving, `${p.id} ${p.price}`).toBeGreaterThanOrEqual(lo)
      expect(p.serving, `${p.id} ${p.price}`).toBeLessThanOrEqual(hi)
      expect(p.dishes.length).toBeGreaterThan(0)
    }
  })

  it('gives the two Bakery Nouveau locations distinct ids and names', () => {
    const bakeries = places.filter((p) => p.name.startsWith('Bakery Nouveau'))
    expect(bakeries.map((p) => p.id).sort()).toEqual(['bakery-capitol-hill', 'bakery-west-seattle'])
    expect(new Set(bakeries.map((p) => p.name)).size).toBe(2)
  })
})
