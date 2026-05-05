import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '@/server/lib/errors';

const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '30d';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET env var is not set');
  return new TextEncoder().encode(secret);
}

export interface AccessTokenPayload {
  sub: string;      // user UUID
  email: string;
  role: string;
  plan: string;
}

export interface RefreshTokenPayload {
  sub: string;      // user UUID
  jti: string;      // token family ID stored in DB
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role, plan: payload.plan })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({ jti: payload.jti })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      sub: payload.sub as string,
      email: payload['email'] as string,
      role: payload['role'] as string,
      plan: payload['plan'] as string,
    };
  } catch (err) {
    const isExpired = err instanceof Error && err.message.includes('exp');
    throw new AppError(
      isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      isExpired ? 'JWT expired' : 'JWT invalid',
      isExpired
        ? 'Sessão expirada. Faça login novamente.'
        : 'Token inválido. Faça login novamente.',
      401,
    );
  }
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      sub: payload.sub as string,
      jti: payload['jti'] as string,
    };
  } catch {
    throw new AppError(
      'TOKEN_INVALID',
      'Refresh token invalid',
      'Sessão inválida. Faça login novamente.',
      401,
    );
  }
}
