// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/password';

describe('password hashing', () => {
  it('gera hash argon2id diferente do plaintext', async () => {
    const hash = await hashPassword('senhaSegura123');
    expect(hash).not.toBe('senhaSegura123');
    expect(hash).toContain('argon2id');
  });

  it('verifica senha correta', async () => {
    const hash = await hashPassword('senhaSegura123');
    expect(await verifyPassword(hash, 'senhaSegura123')).toBe(true);
  });

  it('rejeita senha incorreta', async () => {
    const hash = await hashPassword('senhaSegura123');
    expect(await verifyPassword(hash, 'senhaErrada456')).toBe(false);
  });

  it('hashes distintos para o mesmo plaintext (salt aleatório)', async () => {
    const h1 = await hashPassword('mesmaSenha');
    const h2 = await hashPassword('mesmaSenha');
    expect(h1).not.toBe(h2);
    // Mas ambos verificam corretamente
    expect(await verifyPassword(h1, 'mesmaSenha')).toBe(true);
    expect(await verifyPassword(h2, 'mesmaSenha')).toBe(true);
  });
});
