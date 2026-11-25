/**
 * Types shared by the front end (src/) and the API server (server/).
 * Change them here only, so the two sides cannot drift apart.
 */

export type MealMoment = 'breakfast' | 'lunch' | 'dinner'
export type TravelMode = 'walk' | 'bike' | 'car'

/** A place as the assistant sees it: dataset fields plus travel computed for the chosen mode. */
export type AssistantPlace = {
  id: string
  name: string
  cuisine: string
  neighborhood: string
  address: string
  street: string
  price: string
  serving: number
  rating: number | null
  travelMinutes: number
  waitMinutes: number
  note: string
  dishes: string[]
}

export type LatLon = { lat: number; lon: number }

/** POST /api/assistant body. The server looks places up itself; the browser only sends context. */
export type AssistantRequest = {
  message: string
  /** Free-text area from the location field, e.g. "Seattle, WA" or "Ballard". */
  location: string
  /** Active neighborhood filter, if the area is a known neighborhood. */
  neighborhood: string | null
  /** Active cuisine filter, or null for all food. */
  cuisine: string | null
  mode: TravelMode
  /** Active max budget per person in dollars, or null. */
  budget: number | null
  mealMoment: MealMoment
  /** Current Seattle wall-clock time, "YYYY-MM-DDTHH:MM" in America/Los_Angeles. */
  seattleTime: string
  /** Set only after the user shares their location. */
  userLocation: LatLon | null
}

export type AssistantSource = 'llm' | 'cache' | 'local'

export type AssistantResponse = {
  reply: string
  preference: string | null
  neighborhood: string | null
  /** Door-to-table limit (travel + estimated wait) the assistant applied, in minutes. */
  maxTravelMinutes: number | null
  maxBudget: number | null
  /** Up to 3 place ids, best first. */
  rankedIds: string[]
  reasons: Record<string, string>
  source: AssistantSource
}

export type PlaceRecord = {
  id: string
  name: string
  cuisine: string
  price: '$' | '$$' | '$$$' | '$$$$'
  serving: number
  neighborhood: string
  address: string
  street: string
  miles: number
  lat: number
  lon: number
  wait: number
  rating: number | null
  image: string
  note: string
  dishes: string[]
}

/** Dates are plain "YYYY-MM-DD" strings and times "HH:MM" (Seattle wall clock). Never Date objects. */
export type Plan = {
  id: string
  placeId: string
  date: string
  time: string
  createdAt: string
  updatedAt: string
}

export type CreatePlanInput = { placeId: string; date: string; time: string }
export type UpdatePlanInput = { date?: string; time?: string }

export type Favorite = { placeId: string; createdAt: string }

export type HealthResponse = {
  status: 'ok' | 'degraded'
  version: string
  uptimeSeconds: number
  places: number
  db: boolean
  /** Whether an LLM key is configured. Never the key itself. */
  llmConfigured: boolean
  time: string
}

/** Whether the live AI assistant has an API key. The key itself is never sent to the browser. */
export type AiStatus = {
  configured: boolean
  provider: 'google'
  model: string | null
  /** Show the "add an API key" prompt. Development only unless AI_KEY_PROMPT=on. */
  keyPromptEnabled: boolean
  /** DEMO_DEBUG is on: show the assistant source in the UI. */
  demoDebug: boolean
}

export type SaveAiKeyResponse = {
  configured: true
  /** False when Google could not be reached to check the key; it was saved anyway. */
  verified: boolean
  /** False when the key could not be written to server/.env and only lasts until restart. */
  persisted: boolean
}

export type ApiErrorBody = {
  error: { code: string; message: string; requestId: string }
}
