/**
 * Format check for the LLM API key, which is a Google (Gemini) key. Used by the server and by the setup dialog.
 *
 * It is deliberately loose. Google is moving to new key types, so only Google can say whether a key is valid
 * (the server asks it before saving). This only catches obvious mistakes: a typo-length string, spaces,
 * or a key from another vendor, which start with "sk-".
 */
export const API_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+/=-]{19,199}$/

export function isPlausibleGoogleKey(key: string): boolean {
  return API_KEY_PATTERN.test(key) && !key.startsWith('sk-')
}
