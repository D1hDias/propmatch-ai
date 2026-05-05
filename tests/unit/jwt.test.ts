// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from '@/server/auth/jwt';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
});

const payload = {
  sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'broker@test.local',
  role: 'broker',
  plan: 'free',
};

describe('access tokens', () => {
  it('emite e verifica token válido', async () => {
    const token = await signAccessToken(payload);
    const verified = await verifyAccessToken(token);

    expect(verified.sub).toBe(payload.sub);
    expect(verified.email).toBe(payload.email);
    expect(verified.role).toBe(payload.role);
    expect(verified.plan).toBe(payload.plan);
  });

  it('rejeita token com assinatura adulterada', async () => {
    const token = await signAccessToken(payload);
    const tampered = token.slice(0, -5) + 'XXXXX';

    await expect(verifyAccessToken(tampered)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });
});

describe('refresh tokens', () => {
  it('emite e verifica refresh token válido', async () => {
    const jti = 'test-jti-uuid';
    const token = await signRefreshToken({ sub: payload.sub, jti });
    const verified = await verifyRefreshToken(token);

    expect(verified.sub).toBe(payload.sub);
    expect(verified.jti).toBe(jti);
  });

  it('rejeita refresh token adulterado', async () => {
    const token = await signRefreshToken({ sub: payload.sub, jti: 'jti-x' });
    const tampered = token.slice(0, -5) + 'XXXXX';

    await expect(verifyRefreshToken(tampered)).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });
});
