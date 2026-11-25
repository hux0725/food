import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreatePlanInput, Plan, UpdatePlanInput } from '../../shared/types'
import { ApiError, api } from '../api/client'
import { isMigrated, markMigrated, readLegacyPlans, readLegacySaved } from './legacyStorage'

export type LoadStatus = 'loading' | 'ready' | 'error'
export type Result<T> = { ok: true; value: T } | { ok: false; message: string }

const OFFLINE = "Couldn't reach the server. Check the connection and try again."

function planError(error: unknown): string {
  if (!(error instanceof ApiError)) return OFFLINE
  switch (error.code) {
    case 'CONFLICT':
      return 'That restaurant is already planned for that day. Pick another date.'
    case 'PAST_DATE':
      return 'Pick today or a later date.'
    case 'NOT_FOUND':
      return error.message.startsWith('Plan') ? 'That plan was already removed.' : 'That restaurant is no longer in the list.'
    case 'BAD_REQUEST':
      return 'Pick a valid date and time.'
    default:
      return OFFLINE
  }
}

let migration: Promise<void> | null = null

/** Uploads pre-backend localStorage data once, only if the server has nothing yet. Concurrent callers share one run. */
function migrateLegacy(knownIds: Set<string>): Promise<void> {
  migration ??= runMigration(knownIds).catch((error: unknown) => {
    migration = null
    throw error
  })
  return migration
}

async function runMigration(knownIds: Set<string>) {
  if (isMigrated()) return
  const legacyPlans = readLegacyPlans(knownIds)
  const legacySaved = readLegacySaved(knownIds)
  if (legacyPlans.length || legacySaved.length) {
    const [{ plans }, { favorites }] = await Promise.all([api.listPlans(), api.listFavorites()])
    if (!plans.length && !favorites.length) {
      for (const plan of legacyPlans) await api.createPlan(plan).catch(() => undefined)
      for (const placeId of legacySaved) await api.addFavorite(placeId).catch(() => undefined)
    }
  }
  markMigrated()
}

/** Plans and favorites for the demo user, stored on the server. */
export function useUserData(knownIds: Set<string>) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [plansStatus, setPlansStatus] = useState<LoadStatus>('loading')
  const [saved, setSaved] = useState<string[]>([])
  const [savedStatus, setSavedStatus] = useState<LoadStatus>('loading')
  const [savedError, setSavedError] = useState('')
  const knownRef = useRef(knownIds)
  /** Bumped on every heart click, so a slow failure only rolls back if nothing newer happened. */
  const favoriteVersion = useRef(new Map<string, number>())

  const loadPlans = useCallback(async () => {
    setPlansStatus('loading')
    try {
      await migrateLegacy(knownRef.current).catch(() => undefined)
      const { plans: next } = await api.listPlans()
      setPlans(next)
      setPlansStatus('ready')
    } catch {
      setPlansStatus('error')
    }
  }, [])

  const loadSaved = useCallback(async () => {
    setSavedStatus('loading')
    setSavedError('')
    try {
      await migrateLegacy(knownRef.current).catch(() => undefined)
      const { favorites } = await api.listFavorites()
      setSaved(favorites.map((favorite) => favorite.placeId))
      setSavedStatus('ready')
    } catch {
      setSavedStatus('error')
    }
  }, [])

  useEffect(() => {
    void loadPlans()
    void loadSaved()
  }, [loadPlans, loadSaved])

  const createPlan = useCallback(async (input: CreatePlanInput): Promise<Result<Plan>> => {
    try {
      const { plan } = await api.createPlan(input)
      setPlans((current) => [...current, plan].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)))
      setPlansStatus('ready')
      return { ok: true, value: plan }
    } catch (error) {
      return { ok: false, message: planError(error) }
    }
  }, [])

  const updatePlan = useCallback(async (id: string, changes: UpdatePlanInput): Promise<Result<Plan>> => {
    try {
      const { plan } = await api.updatePlan(id, changes)
      setPlans((current) => current.map((item) => (item.id === id ? plan : item)))
      return { ok: true, value: plan }
    } catch (error) {
      return { ok: false, message: planError(error) }
    }
  }, [])

  const deletePlan = useCallback(async (id: string): Promise<Result<null>> => {
    try {
      await api.deletePlan(id)
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'NOT_FOUND')) return { ok: false, message: planError(error) }
    }
    setPlans((current) => current.filter((item) => item.id !== id))
    return { ok: true, value: null }
  }, [])

  /** Optimistic: the heart flips at once and flips back if the server says no. */
  const toggleSaved = useCallback(async (placeId: string, nextSaved: boolean) => {
    const version = (favoriteVersion.current.get(placeId) ?? 0) + 1
    favoriteVersion.current.set(placeId, version)
    setSavedError('')
    setSaved((current) => (nextSaved ? [...current.filter((id) => id !== placeId), placeId] : current.filter((id) => id !== placeId)))
    try {
      if (nextSaved) await api.addFavorite(placeId)
      else await api.removeFavorite(placeId)
    } catch {
      if (favoriteVersion.current.get(placeId) !== version) return
      setSaved((current) => (nextSaved ? current.filter((id) => id !== placeId) : [...current.filter((id) => id !== placeId), placeId]))
      setSavedError(nextSaved ? "Couldn't save that place. Check the connection and try again." : "Couldn't remove that place. Check the connection and try again.")
    }
  }, [])

  return {
    plans,
    plansStatus,
    loadPlans,
    createPlan,
    updatePlan,
    deletePlan,
    saved,
    savedStatus,
    savedError,
    clearSavedError: useCallback(() => setSavedError(''), []),
    loadSaved,
    toggleSaved,
  }
}
