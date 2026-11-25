import type { AssistantPlace, AssistantResponse, MealMoment, TravelMode } from './types'

/**
 * Assistant logic shared by the server and the browser fallback:
 * parse the message, apply hard filters in code, rank locally, and check reasons against the data.
 * Pure functions only, so both sides give the same answer for the same input.
 */

export const MAX_MESSAGE_CHARS = 500
export const MAX_REASON_CHARS = 140
export const MAX_PICKS = 3

export const COMFORT_CUISINES = ['Italian', 'Japanese', 'American', 'Chinese', 'Pizza', 'Southern', 'Cafe', 'Deli', 'Soul Food']

const CUISINE_RULES: Array<[string, RegExp]> = [
  ['Pizza', /\bpizzas?\b/],
  ['Thai', /\bthai\b|\bcurry\b|\btailandesa\b/],
  ['Vietnamese', /\bvietnamese\b|\bpho\b|\bbanh mi\b|\bvietnamita\b/],
  ['Chinese', /\bchinese\b|\bdumplings?\b|\bdim sum\b|\bxiao long\b|\bchina\b/],
  ['Japanese', /\bjapanese\b|\bsushi\b|\bsoba\b|\bomakase\b|\bramen\b|\bjaponesa\b/],
  ['Mexican', /\bmexican[ao]?\b|\btacos?\b|\boaxaca\b|\bmezcal\b/],
  ['Caribbean', /\bcaribbean\b|\bcaribeña\b/],
  ['Seafood', /\bseafood\b|\boysters?\b|\bchowder\b|\bfish\b|\bmariscos\b/],
  ['French', /\bfrench\b|\bbistro\b|\bfrancesa\b/],
  ['Greek', /\bgreek\b|\bgriega\b/],
  ['Southern', /\bsouthern\b|\bcajun\b|\bcreole\b|\bbeignets?\b|\bgumbo\b/],
  ['Hawaiian', /\bhawaiian\b|\bfried chicken\b|\bpoke\b/],
  ['Cafe', /\bcafe\b|\bcoffee\b|\bpastr(?:y|ies)\b|\bbakery\b|\bbrunch\b|\bbreakfast\b|\bcroissants?\b|\bdesayuno\b/],
  ['Deli', /\bdeli\b|\bice cream\b|\bhelado\b/],
  ['Korean', /\bkorean\b|\bcoreana\b/],
  ['Filipino', /\bfilipino\b|\bfilipina\b/],
  ['Turkish', /\bturkish\b|\bkebap\b|\bkebab\b/],
  ['Laotian', /\blaotian\b|\blao\b/],
  ['Spanish', /\bspanish\b|\bbasque\b|\bpaella\b|\btapas\b|\bespañola\b/],
  ['Lebanese', /\blebanese\b|\bmezze\b|\bhummus\b|\bfalafel\b/],
  ['Guamanian', /\bguamanian\b|\bchamorro\b|\bguam\b/],
  ['Soul Food', /\bsoul food\b/],
  ['Italian', /\bitalian[ao]?\b|\bpasta\b|\blasagna\b/],
  ['Pacific Northwest', /\bpacific northwest\b|\btasting menu\b|\bfine dining\b/],
  ['American', /\bamerican\b|\bburgers?\b|\bpub\b|\bhamburguesas?\b/],
]

const STOP = new Set([
  'have', 'with', 'from', 'that', 'this', 'food', 'want', 'some', 'near', 'minutes', 'minute', 'mins',
  'under', 'about', 'please', 'would', 'like', 'something', 'place', 'places', 'spot', 'spots',
  'good', 'best', 'cheap', 'quick', 'show', 'find', 'need', 'looking', 'really', 'seattle',
  'shortest', 'travel', 'time', 'trip', 'total', 'within', 'options', 'option', 'night', 'date',
  'dinner', 'lunch', 'breakfast', 'tonight', 'today', 'where', 'what', 'when', 'your', 'just',
  'there', 'here', 'them', 'they', 'eat', 'eating', 'restaurant', 'restaurants', 'dollars', 'budget',
  'vegetarian', 'vegan', 'gluten', 'free', 'late', 'open', 'right', 'now', 'great', 'nice', 'tasty',
])

const FOOD_INTENT =
  /\b(eat|eats|eating|food|foods|hungry|starving|restaurants?|dinner|lunch|breakfast|brunch|meal|snack|dessert|drinks?|bite|cuisine|dish|dishes|menu|cheap|budget|date night|tonight|recommend|suggest|somewhere|something good|good spot|treat|anything|whatever|ideas?|options?|recommendations?|comida|restaurante|cena|almuerzo|desayuno|barat[oa]|comer|hambre|surprise|comfort|vegetarian|vegan|gluten|halal|kosher|late night)\b/

const DIETARY = /\b(vegetarian|vegan|veggie|plant[- ]based|gluten|celiac|halal|kosher|dairy|lactose|nut[- ]free|allerg\w*|pescatarian|vegetariana?o?)\b/
const HOURS = /\b(late[- ]night|open (now|late|today|tonight)|still open|opening hours|hours|midnight|24\/7|after (10|11|midnight))\b/
const GREETING = /^(hi|hey|hello|help|hola|yo)\b/

export type ParseContext = {
  neighborhood: string | null
  cuisine: string | null
  budget: number | null
}

export type Constraints = {
  /** Trimmed, length-capped message. */
  text: string
  empty: boolean
  greeting: boolean
  /** A cuisine, "Comfort food" or "Surprise me". */
  preference: string | null
  /** Neighborhood named in the message (not from the filter). */
  namedNeighborhood: string | null
  neighborhood: string | null
  /** Budget stated in the message. */
  textBudget: number | null
  budget: number | null
  /** Door-to-table limit: travel + estimated wait. */
  maxMinutes: number | null
  shortest: boolean
  keywords: string[]
  dietary: boolean
  hours: boolean
  foodIntent: boolean
}

export function truncateMessage(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_MESSAGE_CHARS ? flat.slice(0, MAX_MESSAGE_CHARS) : flat
}

export function parseMessage(message: string, context: ParseContext, neighborhoods: string[]): Constraints {
  const text = truncateMessage(message)
  const lower = text.toLowerCase()
  const byLength = [...neighborhoods].sort((a, b) => b.length - a.length)
  const namedNeighborhood = byLength.find((name) => lower.includes(name.toLowerCase())) ?? null
  const cuisine = CUISINE_RULES.find(([, pattern]) => pattern.test(lower))?.[0] ?? null
  const preference = cuisine ?? (/\bcomfort\b/.test(lower) ? 'Comfort food' : /\bsurprise\b|\bsorpr[eé]nde/.test(lower) ? 'Surprise me' : null)
  const minuteMatch = lower.match(/(\d{1,3})\s*(?:minutes|minute|mins|min|minutos)\b/)
  const hourMatch = lower.match(/\b(an|one|1)\s*hour\b/)
  const dollarMatch = lower.match(/\$\s*(\d{1,4})|(\d{1,4})\s*(?:dollars?|bucks|dólares)/)
  const textBudget = dollarMatch ? Number(dollarMatch[1] || dollarMatch[2]) : null
  const maxMinutes = minuteMatch ? Number(minuteMatch[1]) : hourMatch ? 60 : null
  const shortest = /\b(shortest|closest|nearest|quickest)\b/.test(lower)
  const keywords = lower.split(/[^a-z0-9']+/).filter((word) => word.length > 3 && !STOP.has(word))
  const greeting = GREETING.test(lower)
  const dietary = DIETARY.test(lower)
  const hours = HOURS.test(lower)
  const foodIntent = Boolean(preference || namedNeighborhood || textBudget || maxMinutes || shortest || dietary || hours || FOOD_INTENT.test(lower))
  return {
    text,
    empty: text.length === 0,
    greeting,
    preference,
    namedNeighborhood,
    neighborhood: namedNeighborhood ?? context.neighborhood,
    textBudget: textBudget && textBudget > 0 ? textBudget : null,
    budget: (textBudget && textBudget > 0 ? textBudget : null) ?? context.budget,
    maxMinutes: maxMinutes && maxMinutes > 0 ? maxMinutes : null,
    shortest,
    keywords,
    dietary,
    hours,
    foodIntent,
  }
}

function blob(place: AssistantPlace): string {
  return `${place.name} ${place.cuisine} ${place.neighborhood} ${place.address} ${place.street} ${place.note} ${place.dishes.join(' ')}`.toLowerCase()
}

export function totalMinutes(place: AssistantPlace): number {
  return place.travelMinutes + place.waitMinutes
}

type HardFilters = Pick<Constraints, 'budget' | 'neighborhood' | 'maxMinutes'> & { cuisine: string | null; preference: string | null }

function applyHard(places: AssistantPlace[], f: HardFilters): AssistantPlace[] {
  return places.filter((place) => {
    if (f.budget != null && place.serving > f.budget) return false
    if (f.neighborhood && place.neighborhood !== f.neighborhood) return false
    if (f.maxMinutes != null && totalMinutes(place) > f.maxMinutes) return false
    if (f.preference === 'Comfort food') {
      if (!COMFORT_CUISINES.includes(place.cuisine)) return false
    } else if (f.preference && f.preference !== 'Surprise me') {
      if (place.cuisine !== f.preference) return false
    } else if (f.cuisine && place.cuisine !== f.cuisine) {
      return false
    }
    return true
  })
}

function hardFilters(c: Constraints, filterCuisine: string | null): HardFilters {
  return { budget: c.budget, neighborhood: c.neighborhood, maxMinutes: c.maxMinutes, preference: c.preference, cuisine: filterCuisine }
}

/**
 * Hard constraints are enforced here, before any model sees the list.
 * Keywords only narrow the list when they match something; they never empty it.
 */
export function filterCandidates(places: AssistantPlace[], c: Constraints, filterCuisine: string | null = null): AssistantPlace[] {
  let pool = applyHard(places, hardFilters(c, filterCuisine))
  if (!c.preference && c.keywords.length) {
    const narrowed = pool.filter((place) => c.keywords.some((word) => blob(place).includes(word)))
    if (narrowed.length) pool = narrowed
  }
  return pool
}

/** True when the message matches nothing food-related and no place mentions any of its words. */
export function isOffTopic(places: AssistantPlace[], c: Constraints): boolean {
  if (c.empty || c.greeting || c.foodIntent) return false
  return !places.some((place) => c.keywords.some((word) => blob(place).includes(word)))
}

/** Which single filter to relax, and how many places that would open up. */
export function suggestRelaxation(places: AssistantPlace[], c: Constraints, filterCuisine: string | null): string {
  const base = hardFilters(c, filterCuisine)
  const options: Array<[keyof HardFilters, string]> = [
    ['maxMinutes', `allowing more than ${c.maxMinutes} minutes`],
    ['budget', `raising the budget above $${c.budget}`],
    ['neighborhood', `looking outside ${c.neighborhood}`],
    ['preference', c.preference ? `trying something other than ${c.preference.toLowerCase()}` : ''],
    ['cuisine', filterCuisine ? `clearing the ${filterCuisine} filter` : ''],
  ]
  for (const [key, label] of options) {
    if (base[key] == null || !label) continue
    const count = applyHard(places, { ...base, [key]: null }).length
    if (count) return `Nothing fits all of that. Try ${label}: that opens up ${count} ${count === 1 ? 'place' : 'places'}.`
  }
  return 'Nothing fits all of that. Try relaxing the budget, time, or neighborhood.'
}

function hash(value: string): number {
  let total = 0
  for (const char of value) total = (total * 33 + char.charCodeAt(0)) >>> 0
  return total
}

export function rankLocal(pool: AssistantPlace[], c: Constraints): AssistantPlace[] {
  const copy = pool.slice()
  if (c.preference === 'Surprise me') {
    const seed = c.text.length + copy.length
    return copy.sort((a, b) => hash(a.id + seed) - hash(b.id + seed))
  }
  if (c.shortest) return copy.sort((a, b) => a.travelMinutes - b.travelMinutes || (b.rating ?? 0) - (a.rating ?? 0))
  if (c.maxMinutes != null) return copy.sort((a, b) => totalMinutes(a) - totalMinutes(b) || (b.rating ?? 0) - (a.rating ?? 0))
  return copy.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
}

/** Rated places get a small edge, but a much longer trip outweighs it. Unrated places count as 4.2. */
function score(place: AssistantPlace): number {
  return (place.rating ?? 4.2) * 10 - totalMinutes(place) / 6
}

const MODE_WORD: Record<TravelMode, string> = { walk: 'walk', bike: 'bike ride', car: 'drive' }

export function factualReason(place: AssistantPlace, mode: TravelMode): string {
  return capReason(
    `${place.cuisine} in ${place.neighborhood}: about ${place.travelMinutes} min ${MODE_WORD[mode]} plus ~${place.waitMinutes} min wait, around $${place.serving} per person.`,
  )
}

export function capReason(reason: string, max = MAX_REASON_CHARS): string {
  const flat = reason.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`
}

function near(value: number, targets: number[], tolerance = 1): boolean {
  return targets.some((target) => Math.abs(value - target) <= tolerance)
}

/**
 * False if the reason states a price, wait, travel time, rating, or opening hours that the data does not back up.
 * Numbers equal to the user's own budget or time limit are allowed ("fits your $30 budget").
 */
export function reasonMatchesData(reason: string, place: AssistantPlace, c: Pick<Constraints, 'budget' | 'maxMinutes'>): boolean {
  const lower = reason.toLowerCase()
  for (const match of lower.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)) {
    const value = Number(match[1])
    if (!near(value, [place.serving]) && value !== c.budget) return false
  }
  for (const match of lower.matchAll(/(\d+)\s*(?:-\s*)?(?:min|mins|minutes|minute|minutos)\b/g)) {
    const value = Number(match[1])
    if (!near(value, [place.travelMinutes, place.waitMinutes, totalMinutes(place)]) && value !== c.maxMinutes) return false
  }
  for (const match of lower.matchAll(/(\d(?:\.\d)?)\s*(?:stars?|★|\/\s*5|rating)|rated\s*(\d(?:\.\d)?)/g)) {
    const value = Number(match[1] ?? match[2])
    if (place.rating == null || Math.abs(value - place.rating) > 0.05) return false
  }
  if (/\b(\d{1,2}(:\d{2})?\s?(am|pm)|open until|opens at|closes at|open late|open 24)\b/.test(lower)) return false
  return true
}

function joinNames(names: string[]): string {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export const OFF_TOPIC_REPLY =
  'I can help with Seattle restaurants. Try a cuisine, a budget, a neighborhood, or how much time you have, like "pasta under $30".'
export const EMPTY_REPLY = 'Tell me what you feel like: a cuisine, a budget, a neighborhood, or how much time you have.'
export const DIETARY_NOTE = "I can't confirm dietary options: this sample data has no dietary information, so check with the restaurant."
export const HOURS_NOTE = "I don't have opening hours, so check that they're open before you go."

export function composeReply(ranked: AssistantPlace[], c: Constraints, mode: TravelMode, nothingFits: string | null): string {
  const notes = [c.dietary ? DIETARY_NOTE : '', c.hours ? HOURS_NOTE : ''].filter(Boolean)
  if (!ranked.length) return [nothingFits ?? 'No exact matches yet. Try a wider travel time, a higher budget, or another neighborhood.', ...notes].join(' ')
  if (c.greeting && !c.foodIntent) {
    return `${EMPTY_REPLY} ${ranked[0].name} in ${ranked[0].neighborhood} is one place already on the list.`
  }
  const focus = [
    c.preference && c.preference !== 'Surprise me' ? `for ${c.preference.toLowerCase()}` : '',
    c.neighborhood ? `in ${c.neighborhood}` : '',
    c.budget != null ? `at or under $${c.budget}` : '',
    c.maxMinutes != null ? `within about ${c.maxMinutes} minutes door to table by ${MODE_WORD[mode]}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const count = ranked.length === 1 ? 'one strong match' : ranked.length === 2 ? 'two strong matches' : 'three strong matches'
  const review = ranked.length === 1 ? 'You can review it or add it to your calendar below.' : 'You can review them or add one to your calendar below.'
  return [`I found ${count}${focus ? ` ${focus}` : ''}: ${joinNames(ranked.map((place) => place.name))}.`, ...notes, review].join(' ')
}

export type CoreInput = {
  message: string
  mode: TravelMode
  neighborhood: string | null
  cuisine: string | null
  budget: number | null
  mealMoment: MealMoment
}

export type Prepared =
  | { kind: 'answer'; response: AssistantResponse }
  | { kind: 'candidates'; constraints: Constraints; candidates: AssistantPlace[] }

/** Everything that can be decided without a model. Returns either a final answer or the filtered candidates to rank. */
export function prepare(input: CoreInput, places: AssistantPlace[], neighborhoods: string[]): Prepared {
  const c = parseMessage(input.message, input, neighborhoods)
  const base = { preference: c.preference, neighborhood: c.namedNeighborhood, maxTravelMinutes: c.maxMinutes, maxBudget: c.textBudget, source: 'local' as const }
  if (c.empty) return { kind: 'answer', response: { ...base, reply: EMPTY_REPLY, rankedIds: [], reasons: {} } }
  if (isOffTopic(places, c)) {
    return { kind: 'answer', response: { ...base, preference: null, neighborhood: null, maxTravelMinutes: null, maxBudget: null, reply: OFF_TOPIC_REPLY, rankedIds: [], reasons: {} } }
  }
  const candidates = filterCandidates(places, c, input.cuisine)
  if (!candidates.length) {
    return { kind: 'answer', response: { ...base, reply: composeReply([], c, input.mode, suggestRelaxation(places, c, input.cuisine)), rankedIds: [], reasons: {} } }
  }
  return { kind: 'candidates', constraints: c, candidates }
}

export function finalize(ranked: AssistantPlace[], reasons: Record<string, string>, c: Constraints, mode: TravelMode, source: AssistantResponse['source']): AssistantResponse {
  const picks = ranked.slice(0, MAX_PICKS)
  return {
    reply: composeReply(picks, c, mode, null),
    preference: c.preference,
    neighborhood: c.namedNeighborhood,
    maxTravelMinutes: c.maxMinutes,
    maxBudget: c.textBudget,
    rankedIds: picks.map((place) => place.id),
    reasons: Object.fromEntries(picks.map((place) => [place.id, reasons[place.id] ?? factualReason(place, mode)])),
    source,
  }
}

/** The rule-based assistant. Used when the server or the model is unavailable. */
export function localAnswer(input: CoreInput, places: AssistantPlace[], neighborhoods: string[]): AssistantResponse {
  const prepared = prepare(input, places, neighborhoods)
  if (prepared.kind === 'answer') return prepared.response
  return finalize(rankLocal(prepared.candidates, prepared.constraints), {}, prepared.constraints, input.mode, 'local')
}

/** Cache key: same words + same filters → same answer. Case, spacing and trailing punctuation do not matter. */
export function cacheKey(input: Pick<CoreInput, 'message' | 'mode' | 'neighborhood' | 'cuisine' | 'budget'>): string {
  const text = truncateMessage(input.message)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”"'`’]/g, '')
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [text, input.mode, input.neighborhood ?? '', input.cuisine ?? '', input.budget ?? ''].join('|')
}

/** Moment-of-day pick for the assistant intro card. */
const MOMENT_CUISINES: Record<MealMoment, string[]> = {
  breakfast: ['Cafe', 'Deli', 'American'],
  lunch: ['Vietnamese', 'Chinese', 'Seafood', 'Caribbean', 'Deli', 'Cafe'],
  dinner: ['Italian', 'Japanese', 'Seafood', 'Pacific Northwest', 'French', 'Southern'],
}

export function pickForMoment(mealMoment: MealMoment, places: AssistantPlace[]): AssistantPlace | null {
  const preferred = MOMENT_CUISINES[mealMoment]
  return places.find((place) => preferred.includes(place.cuisine)) ?? places[0] ?? null
}
