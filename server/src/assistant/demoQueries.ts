/**
 * The exact assistant queries typed in DEMO_SCRIPT.md, chosen from the eval run (each returns three picks,
 * except the last, which shows the "nothing fits" answer). The cache is pre-warmed with these on server start,
 * and a test checks DEMO_SCRIPT.md lists every one of them.
 */
export const DEMO_QUERIES = [
  'pasta under $30',
  'cheap ramen near Capitol Hill',
  'I have 30 minutes',
  'date night under $60 in Ballard',
  'dumplings in the International District',
  'Surprise me',
  'sushi under $5 in Ballard',
] as const

/** Messages sent by the suggestion chips in the assistant panel. Pre-warmed too. */
export const SUGGESTION_QUERIES = ['Comfort food', 'I have 30 minutes', 'Shortest travel time', 'Surprise me'] as const

export const PREWARM_QUERIES = [...new Set<string>([...DEMO_QUERIES, ...SUGGESTION_QUERIES])]
