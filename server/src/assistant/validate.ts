import { z } from 'zod'
import { MAX_PICKS, capReason, factualReason, reasonMatchesData, type Constraints } from '../../../shared/assistant-core.js'
import type { AssistantPlace, TravelMode } from '../../../shared/types.js'

const pickSchema = z.object({ placeId: z.string().min(1).max(100), reason: z.string().max(2000) })

const outputSchema = z.object({
  status: z.enum(['ok', 'no_match', 'off_topic']).default('ok'),
  picks: z.array(z.unknown()).max(20),
})

export type ModelOutput = { status: 'ok' | 'no_match' | 'off_topic'; picks: Array<{ placeId: string; reason: string }> }

/** Pulls the JSON object out of the model text, tolerating code fences or stray prose around it. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '').trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    return JSON.parse(unfenced.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** Returns null when the output is unusable as a whole. Individual malformed picks are dropped. */
export function parseModelOutput(text: string): ModelOutput | null {
  const parsed = outputSchema.safeParse(extractJson(text))
  if (!parsed.success) return null
  const picks = parsed.data.picks.flatMap((pick) => {
    const one = pickSchema.safeParse(pick)
    return one.success ? [one.data] : []
  })
  return { status: parsed.data.status, picks }
}

/**
 * Keeps only candidate ids (in the model's order, no duplicates, at most 3), caps reasons,
 * and replaces any reason whose numbers or hours disagree with the data by a factual one.
 */
export function groundPicks(
  output: ModelOutput,
  candidates: AssistantPlace[],
  constraints: Pick<Constraints, 'budget' | 'maxMinutes'>,
  mode: TravelMode,
): { ranked: AssistantPlace[]; reasons: Record<string, string>; dropped: number; rewritten: number } {
  const byId = new Map(candidates.map((place) => [place.id, place]))
  const ranked: AssistantPlace[] = []
  const reasons: Record<string, string> = {}
  let dropped = 0
  let rewritten = 0
  for (const pick of output.picks) {
    const place = byId.get(pick.placeId)
    if (!place || reasons[place.id] !== undefined) {
      dropped++
      continue
    }
    if (ranked.length >= MAX_PICKS) break
    const capped = capReason(pick.reason)
    const ok = capped.length > 0 && reasonMatchesData(capped, place, constraints)
    if (!ok) rewritten++
    reasons[place.id] = ok ? capped : factualReason(place, mode)
    ranked.push(place)
  }
  return { ranked, reasons, dropped, rewritten }
}
