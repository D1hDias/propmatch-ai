import 'server-only';
import { v4 as uuidv4 } from 'uuid';

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'FEATURE_GATED'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_CONFLICT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CONCURRENCY_EXCEEDED'
  | 'BRIEFING_EXTRACTION_FAILED'
  | 'BRIEFING_HITL_REQUIRED'
  | 'SOURCE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly developerMessage: string,
    public readonly userMessage: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(developerMessage);
    this.name = 'AppError';
  }
}

export function toErrorResponse(error: AppError, requestId?: string) {
  return {
    error: {
      code: error.code,
      message: error.developerMessage,
      user_message: error.userMessage,
      ...(error.details ? { details: error.details } : {}),
      request_id: requestId ?? `req_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
    },
  };
}
