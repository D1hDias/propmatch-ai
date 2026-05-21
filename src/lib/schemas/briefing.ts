import { z } from 'zod';

// When structured_criteria is provided (from the Categories tab),
// LLM extraction is bypassed and the search runs directly.
const structuredCriteriaSchema = z.object({
  purpose: z.enum(['sale', 'rent']),
  property_types: z.array(z.string()).default([]),
  neighborhoods: z.array(z.string()).default([]),
  city: z.string().default('Rio de Janeiro'),
  price_min: z.number().nullable().optional(),
  price_max: z.number().nullable().optional(),
  bedrooms_min: z.number().nullable().optional(),
  parking_min: z.number().nullable().optional(),
  area_min: z.number().nullable().optional(),
  area_max: z.number().nullable().optional(),
}).optional();

export const createBriefingSchema = z.object({
  raw_text: z
    .string()
    .min(10, 'Briefing deve ter pelo menos 10 caracteres.')
    .max(2000, 'Briefing não pode ultrapassar 2000 caracteres.')
    .trim(),
  client_id: z.string().uuid().optional(),
  custom_urls: z
    .array(z.string().url('URL inválida.').max(500))
    .max(10, 'Máximo de 10 URLs customizadas.')
    .default([]),
  partner_site_ids: z
    .array(z.string().uuid())
    .max(20)
    .default([]),
  structured_criteria: structuredCriteriaSchema,
}).superRefine((data, ctx) => {
  const hasSource = data.custom_urls.length > 0 || data.partner_site_ids.length > 0;
  if (!hasSource) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: 'array',
      inclusive: true,
      path: ['custom_urls'],
      message: 'Adicione pelo menos um link de imobiliária ou selecione um site parceiro.',
    });
  }
});

export type CreateBriefingInput = z.infer<typeof createBriefingSchema>;
