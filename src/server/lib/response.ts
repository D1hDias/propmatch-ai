import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { AppError, toErrorResponse } from './errors';

export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(error: unknown): NextResponse {
  const requestId = `req_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  if (error instanceof AppError) {
    return NextResponse.json(toErrorResponse(error, requestId), {
      status: error.statusCode,
      headers: { 'X-Request-Id': requestId },
    });
  }

  Sentry.captureException(error);
  console.error('[api] Unhandled error:', error);
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error',
        user_message: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
        request_id: requestId,
      },
    },
    { status: 500, headers: { 'X-Request-Id': requestId } },
  );
}

export function setRefreshCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_MAX_AGE,
    path: '/',
  });
  return response;
}

export function clearRefreshCookie(response: NextResponse): NextResponse {
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
