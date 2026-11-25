import { places } from '../../../src/data/places.js'
import type { PlaceRecord } from '../../../shared/types.js'
import type { Db } from './index.js'

/** The dataset the browser also bundles. Keeping one source means the two can never disagree. */
export const SEED_PLACES: PlaceRecord[] = places.map((place) => ({ ...place }))
export const EXPECTED_PLACE_COUNT = SEED_PLACES.length

export function seedPlaces(db: Db): number {
  return db.upsertPlaces(SEED_PLACES)
}
