import { z } from 'zod';

export const PRESET_PORTALS = ['zap', 'vivareal'] as const;
export type PresetPortal = (typeof PRESET_PORTALS)[number];

export const PORTAL_LABELS: Record<PresetPortal, string> = {
  zap: 'ZAP Imóveis',
  vivareal: 'Viva Real',
};

export const createBriefingSchema = z.object({
  raw_text: z
    .string()
    .min(10, 'Briefing deve ter pelo menos 10 caracteres.')
    .max(2000, 'Briefing não pode ultrapassar 2000 caracteres.')
    .trim(),
  client_id: z.string().uuid().optional(),
  portals: z
    .array(z.enum(PRESET_PORTALS))
    .default(['zap', 'vivareal']),
  custom_urls: z
    .array(z.string().url('URL inválida.').max(500))
    .max(10, 'Máximo de 10 URLs customizadas.')
    .default([]),
}).superRefine((data, ctx) => {
  if (data.portals.length === 0 && data.custom_urls.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 1,
      type: 'array',
      inclusive: true,
      path: ['portals'],
      message: 'Selecione pelo menos um portal ou adicione um link de imobiliária.',
    });
  }
});

export type CreateBriefingInput = z.infer<typeof createBriefingSchema>;
