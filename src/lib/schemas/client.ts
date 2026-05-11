import { z } from 'zod';

export const CLIENT_URGENCY_LABELS = {
  ativo: 'Buscando ativamente',
  prazo: 'Tem prazo definido',
  explorando: 'Explorando o mercado',
} as const;

export const CLIENT_CRM_STATUS_LABELS = {
  ativo: 'Ativo',
  negociacao: 'Em negociação',
  fechado: 'Fechado',
  pausado: 'Pausado',
} as const;

export const CLIENT_CRM_STATUS_COLORS = {
  ativo: 'bg-[#4FD66E]/10 text-[#4FD66E]',
  negociacao: 'bg-[#FF9F00]/10 text-[#FF9F00]',
  fechado: 'bg-primary/10 text-primary',
  pausado: 'bg-muted text-muted-foreground',
} as const;

export const clientProfileSchema = z.object({
  // Search criteria preferences
  neighborhoods: z.array(z.string().max(100)).max(10).default([]),
  propertyTypes: z.array(z.string().max(50)).max(5).default([]),
  bedroomsMin: z.number().int().min(0).max(20).nullable().optional(),
  bedroomsMax: z.number().int().min(0).max(20).nullable().optional(),
  priceMin: z.number().min(0).nullable().optional(),
  priceMax: z.number().min(0).nullable().optional(),
  budgetFlexibility: z.number().int().min(0).max(50).default(0), // % above priceMax
  areaMin: z.number().min(0).nullable().optional(),
  purpose: z.enum(['buy', 'rent']).default('buy'),
  // Must-haves and nice-to-haves
  mustHaves: z.array(z.string().max(100)).max(20).default([]),
  niceToHaves: z.array(z.string().max(100)).max(20).default([]),
  // Timeline & motivation
  deadline: z.string().datetime().nullable().optional(), // ISO string
  paymentMethod: z.enum(['cash', 'financing', 'fgts', 'mixed']).nullable().optional(),
  motivation: z.enum(['moradia', 'investimento', 'comercial']).nullable().optional(),
});

export type ClientProfile = z.infer<typeof clientProfileSchema>;

export const createClientSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório.').max(200),
  phone: z.string().regex(/^\+\d{7,15}$/, 'Formato: +5511999999999').optional().or(z.literal('')),
  email: z.string().email('E-mail inválido.').optional().or(z.literal('')),
  notes: z.string().max(2000).optional(),
  urgency: z.enum(['ativo', 'prazo', 'explorando']).default('explorando'),
  crmStatus: z.enum(['ativo', 'negociacao', 'fechado', 'pausado']).default('ativo'),
  matchThreshold: z.number().int().min(0).max(100).default(70),
  profile: clientProfileSchema.optional(),
});

export const updateClientSchema = createClientSchema.partial().extend({
  archiveStatus: z.enum(['active', 'soft_archived', 'pending_delete']).optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
