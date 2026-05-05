import 'server-only';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { hashPassword, verifyPassword } from './password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './jwt';
import type { SignupInput, LoginInput } from '@/lib/schemas/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
}

export async function signup(input: SignupInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    // Account-enumeration safe: return generic success but don't create duplicate.
    // Caller logs and optionally sends "forgot password?" email — done in a real impl.
    throw new AppError(
      'RESOURCE_CONFLICT',
      `Email already registered: ${input.email}`,
      'Este e-mail já está cadastrado. Esqueceu sua senha?',
      409,
    );
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      phone: input.phone ?? null,
      passwordHash,
      lgpdConsentAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: 'user.signup',
      targetType: 'user',
      targetId: user.id,
      details: { method: 'email_password' },
    },
  });

  const tokens = await _issueTokens(user.id, user.email, user.role, user.plan);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
    tokens,
  };
}

export async function login(input: LoginInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Constant-time path: always run argon2 even for unknown email
  const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const isValid = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(dummyHash, input.password).then(() => false);

  if (!user || !isValid) {
    throw new AppError(
      'INVALID_CREDENTIALS',
      'Invalid email or password',
      'E-mail ou senha inválidos.',
      401,
    );
  }

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: 'user.login',
      targetType: 'user',
      targetId: user.id,
    },
  });

  const tokens = await _issueTokens(user.id, user.email, user.role, user.plan);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan },
    tokens,
  };
}

export async function refresh(rawRefreshToken: string): Promise<AuthTokens> {
  const payload = await verifyRefreshToken(rawRefreshToken);
  const tokenHash = hashToken(rawRefreshToken);

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError(
      'TOKEN_INVALID',
      'Refresh token not found, revoked, or expired',
      'Sessão expirada. Faça login novamente.',
      401,
    );
  }

  // Revoke the old token atomically before issuing a new one (rotation)
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
  return _issueTokens(user.id, user.email, user.role, user.plan);
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function _issueTokens(
  userId: string,
  email: string,
  role: string,
  plan: string,
): Promise<AuthTokens> {
  const jti = uuidv4();
  const rawRefresh = await signRefreshToken({ sub: userId, jti });
  const tokenHash = hashToken(rawRefresh);

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });

  const accessToken = await signAccessToken({ sub: userId, email, role, plan });
  return { accessToken, refreshToken: rawRefresh };
}
