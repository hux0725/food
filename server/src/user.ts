import type { FastifyRequest } from 'fastify'

/** The single demo account. Every plan and favorite query is scoped by this id. */
export const DEMO_USER_ID = 'demo-user'

// TODO(auth): replace with the signed-in user's id from the session once real accounts exist.
export function currentUserId(_request: FastifyRequest): string {
  return DEMO_USER_ID
}
