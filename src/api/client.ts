import type {
  AiStatus,
  ApiErrorBody,
  AssistantRequest,
  AssistantResponse,
  CreatePlanInput,
  Favorite,
  HealthResponse,
  PlaceRecord,
  Plan,
  SaveAiKeyResponse,
  UpdatePlanInput,
} from '../../shared/types'

/** Thrown for any failed API call. `code` matches the server's error codes, plus SERVER_UNREACHABLE and TIMEOUT. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

const SERVER_UNREACHABLE = "Can't reach the app server."
const DEFAULT_TIMEOUT_MS = 8_000

type RequestOptions = { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Plain AbortController + setTimeout: AbortSignal.any/timeout are missing on older iPhones.
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const forwardAbort = () => controller.abort()
  options.signal?.addEventListener('abort', forwardAbort)
  let response: Response
  let body: unknown
  try {
    try {
      response = await fetch(path, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })
      body = response.status === 204 ? undefined : await response.json().catch(() => null)
    } catch {
      if (timedOut) throw new ApiError('TIMEOUT', 'The server took too long to answer.', 0)
      throw new ApiError('SERVER_UNREACHABLE', SERVER_UNREACHABLE, 0)
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forwardAbort)
  }

  if (response.status === 204) return undefined as T
  if (response.ok) {
    if (body === null) throw new ApiError('BAD_RESPONSE', 'The server sent an unreadable answer.', response.status)
    return body as T
  }

  const error = (body as ApiErrorBody | null)?.error
  // A non-JSON 5xx comes from the dev proxy or the host when the API process is not running.
  if (!error && response.status >= 500) throw new ApiError('SERVER_UNREACHABLE', SERVER_UNREACHABLE, response.status)
  throw new ApiError(error?.code ?? `HTTP_${response.status}`, error?.message ?? `The server responded ${response.status}.`, response.status)
}

const enc = encodeURIComponent

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  listPlaces: (filters: { q?: string; neighborhood?: string; cuisine?: string; maxPrice?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(filters).flatMap(([key, value]) => (value === undefined || value === '' ? [] : [[key, String(value)]])))
    const query = params.toString()
    return request<{ places: PlaceRecord[]; count: number }>(`/api/places${query ? `?${query}` : ''}`)
  },
  getPlace: (id: string) => request<{ place: PlaceRecord }>(`/api/places/${enc(id)}`),

  listPlans: () => request<{ plans: Plan[] }>('/api/plans'),
  createPlan: (input: CreatePlanInput) => request<{ plan: Plan }>('/api/plans', { method: 'POST', body: input }),
  updatePlan: (id: string, changes: UpdatePlanInput) => request<{ plan: Plan }>(`/api/plans/${enc(id)}`, { method: 'PATCH', body: changes }),
  deletePlan: (id: string) => request<void>(`/api/plans/${enc(id)}`, { method: 'DELETE' }),

  listFavorites: () => request<{ favorites: Favorite[] }>('/api/favorites'),
  addFavorite: (placeId: string) => request<{ favorite: Favorite }>(`/api/favorites/${enc(placeId)}`, { method: 'PUT' }),
  removeFavorite: (placeId: string) => request<void>(`/api/favorites/${enc(placeId)}`, { method: 'DELETE' }),

  /** The server's own LLM deadline is 6 s; this leaves room for the fallback answer to arrive. */
  askAssistant: (body: AssistantRequest, signal?: AbortSignal) =>
    request<AssistantResponse>('/api/assistant', { method: 'POST', body, timeoutMs: 9_000, signal }),

  getAiStatus: () => request<AiStatus>('/api/ai/status', { timeoutMs: 5_000 }),
  saveAiKey: (apiKey: string) => request<SaveAiKeyResponse>('/api/ai/key', { method: 'POST', body: { apiKey }, timeoutMs: 20_000 }),
}
