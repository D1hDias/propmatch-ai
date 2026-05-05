import { describe, it, expect } from 'vitest';
import { signupSchema, loginSchema } from '@/lib/schemas/auth';

describe('signupSchema', () => {
  const valid = {
    name: 'Maria Silva',
    email: 'maria@exemplo.com.br',
    password: 'senhaSegura123',
    lgpd_consent: true as const,
  };

  it('aceita dados válidos', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it('normaliza email para lowercase', () => {
    const result = signupSchema.safeParse({ ...valid, email: 'MARIA@EXEMPLO.COM.BR' });
    expect(result.success && result.data.email).toBe('maria@exemplo.com.br');
  });

  it('rejeita senha menor que 10 caracteres', () => {
    const result = signupSchema.safeParse({ ...valid, password: 'curta' });
    expect(result.success).toBe(false);
  });

  it('rejeita sem consentimento LGPD', () => {
    const result = signupSchema.safeParse({ ...valid, lgpd_consent: false });
    expect(result.success).toBe(false);
  });

  it('rejeita email inválido', () => {
    const result = signupSchema.safeParse({ ...valid, email: 'nao-e-email' });
    expect(result.success).toBe(false);
  });

  it('rejeita telefone fora do formato E.164', () => {
    const result = signupSchema.safeParse({ ...valid, phone: '11987654321' });
    expect(result.success).toBe(false);
  });

  it('aceita telefone no formato E.164', () => {
    const result = signupSchema.safeParse({ ...valid, phone: '+5511987654321' });
    expect(result.success).toBe(true);
  });
});

describe('loginSchema', () => {
  const valid = { email: 'maria@exemplo.com.br', password: 'qualquercoisa' };

  it('aceita dados válidos', () => {
    expect(loginSchema.safeParse(valid).success).toBe(true);
  });

  it('normaliza email para lowercase', () => {
    const result = loginSchema.safeParse({ ...valid, email: 'MARIA@EXEMPLO.COM.BR' });
    expect(result.success && result.data.email).toBe('maria@exemplo.com.br');
  });

  it('rejeita password vazio', () => {
    const result = loginSchema.safeParse({ ...valid, password: '' });
    expect(result.success).toBe(false);
  });
});
