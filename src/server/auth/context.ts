import 'server-only';
import type { NextRequest } from 'next/server';
import { verifyAccessToken, type AccessTokenPayload } from './jwt';
import { AppError } from '@/server/lib/errors';

export type RequestContext = AccessTokenPayload;

/**
 * Extracts and verifies the Bearer JWT from the Authorization header.
 * Throws AppError(TOKEN_INVALID/TOKEN_EXPIRED) if missing or invalid.
 * Use this in every authenticated route handler.
 */
export async function requireAuth(req: NextRequest): Promise<RequestContext> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(
      'TOKEN_INVALID',
      'Missing Authorization header',
      'Autenticação necessária. Faça login para continuar.',
      401,
    );
  }
  const token = header.slice(7);
  return verifyAccessToken(token);
}
