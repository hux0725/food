import type { LatLon, TravelMode } from './types'

/** Rough minutes from Pike Place Market. These are planning estimates, not live traffic. */
export function travelMinutes(miles: number, mode: TravelMode): number {
  const safeMiles = Number.isFinite(miles) && miles > 0 ? miles : 0
  if (mode === 'walk') return Math.max(5, Math.round((safeMiles / 3) * 60))
  if (mode === 'bike') return Math.max(3, Math.round((safeMiles / 10) * 60))
  return Math.max(6, Math.round((safeMiles / 15) * 60) + 4)
}

export function formatMiles(miles: number): string {
  const rounded = Math.round(miles * 10) / 10
  return `${rounded} mi`
}

/** Straight-line distance in miles (Haversine). Used only to sort by "closest to you". */
export function haversineMiles(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}
