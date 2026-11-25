import { localAnswer } from '../../shared/assistant-core'
import { NEIGHBORHOODS } from '../data/places'
import type { AssistantPlace, AssistantRequest, AssistantResponse } from './types'

export { COMFORT_CUISINES, pickForMoment, totalMinutes } from '../../shared/assistant-core'

/** On-device assistant: same rules as the server's fallback, run against the bundled dataset. */
export function localAssistant(request: AssistantRequest, places: AssistantPlace[]): AssistantResponse {
  return localAnswer(request, places, [...NEIGHBORHOODS])
}
