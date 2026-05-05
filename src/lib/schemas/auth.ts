import { z } from 'zod';

const phoneRegex = /^\+\d{10,15}$/;

export const signupSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  email: z.string().email().toLowerCase(),
  password: z.string().min(10).max(256),
  phone: z.string().regex(phoneRegex, 'Telefone deve estar no formato E.164 (+5511987654321)').optional(),
  lgpd_consent: z.literal(true, {
    errorMap: () => ({ message: 'Consentimento LGPD é obrigatório' }),
  }),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
