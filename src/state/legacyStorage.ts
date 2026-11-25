import { isValidDateString, isValidTimeString } from '../../shared/dates'

/**
 * Before the backend existed, plans and favorites lived in localStorage under these keys.
 * They are read once, validated, uploaded if the server has nothing, and then removed.
 */
export const LEGACY_SAVED_KEY = 'bite-saved'
export const LEGACY_PLANS_KEY = 'bite-plans'
export const MIGRATED_KEY = 'bite-migrated-v1'

export type LegacyPlan = { placeId: string; date: string; time: string }

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    // Corrupt JSON, or storage blocked (private mode): treat as empty.
    return null
  }
}

export function readLegacySaved(knownIds: Set<string>): string[] {
  const value = readJson(LEGACY_SAVED_KEY)
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
}

/** Accepts the old `{ placeId, date, time }` shape only; anything else (older shapes, bad dates) is dropped. */
export function readLegacyPlans(knownIds: Set<string>): LegacyPlan[] {
  const value = readJson(LEGACY_PLANS_KEY)
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const plan = item as Record<string, unknown>
    if (typeof plan.placeId !== 'string' || !knownIds.has(plan.placeId)) return []
    if (!isValidDateString(plan.date) || !isValidTimeString(plan.time)) return []
    return [{ placeId: plan.placeId, date: plan.date, time: plan.time }]
  })
}

export function isMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATED_KEY) === '1'
  } catch {
    return true
  }
}

export function markMigrated() {
  try {
    localStorage.setItem(MIGRATED_KEY, '1')
    localStorage.removeItem(LEGACY_SAVED_KEY)
    localStorage.removeItem(LEGACY_PLANS_KEY)
  } catch {
    // Storage blocked: nothing to clean up.
  }
}
