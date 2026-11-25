import { api } from '../api/client'
import { localAssistant } from './local'
import type { AssistantPlace, AssistantRequest, AssistantResponse } from './types'

const SOURCES = new Set(['llm', 'cache', 'local'])

function isValidResponse(body: unknown, known: Set<string>): body is AssistantResponse {
  if (!body || typeof body !== 'object') return false
  const value = body as Partial<AssistantResponse>
  return (
    typeof value.reply === 'string' &&
    Array.isArray(value.rankedIds) &&
    value.rankedIds.length <= 3 &&
    value.rankedIds.every((id) => typeof id === 'string' && known.has(id)) &&
    typeof value.reasons === 'object' &&
    value.reasons !== null &&
    typeof value.source === 'string' &&
    SOURCES.has(value.source)
  )
}

/**
 * Asks the server (live model → demo cache → server-side matcher). On any failure, timeout or odd answer,
 * the on-device matcher answers instead. It never throws and never returns an error for the UI to show.
 */
export async function askFoodAssistant(request: AssistantRequest, places: AssistantPlace[]): Promise<AssistantResponse> {
  try {
    const response = await api.askAssistant(request)
    if (isValidResponse(response, new Set(places.map((place) => place.id)))) return response
  } catch {
    // Fall through to the on-device answer.
  }
  return localAssistant(request, places)
}
