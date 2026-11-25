import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'

/**
 * Every error response from the API has the same shape:
 *   { "error": { "code": "NOT_FOUND", "message": "...", "requestId": "..." } }
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'PAST_DATE'
  | 'AI_NOT_CONFIGURED'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_KEY_FORMAT'
  | 'AI_KEY_REJECTED'
  | 'AI_KEY_ALREADY_SET'
  | 'INTERNAL'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', 404, `${what} was not found.`)

export function sendError(reply: FastifyReply, request: FastifyRequest, code: ErrorCode, statusCode: number, message: string) {
  return reply.status(statusCode).send({
    error: { code, message, requestId: request.id },
  })
}

/** Converts any thrown error into the standard error shape. Never leaks stack traces to clients. */
export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return sendError(reply, request, error.code, error.statusCode, error.message)
  }
  if (error instanceof ZodError) {
    const first = error.issues[0]
    const where = first?.path.join('.') || 'body'
    return sendError(reply, request, 'BAD_REQUEST', 400, `Invalid ${where}: ${first?.message ?? 'bad input'}.`)
  }
  const statusCode = (error as FastifyError).statusCode
  if (statusCode === 413) {
    return sendError(reply, request, 'PAYLOAD_TOO_LARGE', 413, 'Request body is too large.')
  }
  if (statusCode === 415) {
    return sendError(reply, request, 'BAD_REQUEST', 415, 'Send JSON with Content-Type: application/json.')
  }
  if ((error as FastifyError).code === 'FST_ERR_CTP_INVALID_JSON' || (error instanceof SyntaxError && statusCode === 400)) {
    return sendError(reply, request, 'BAD_REQUEST', 400, 'Request body is not valid JSON.')
  }
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return sendError(reply, request, 'BAD_REQUEST', statusCode, error.message)
  }
  request.log.error({ err: error }, 'Unhandled error')
  return sendError(reply, request, 'INTERNAL', 500, 'Something went wrong on the server. Please try again.')
}
