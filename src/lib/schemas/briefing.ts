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
    .min(1, 'Selecione pelo menos um portal.')
    .default(['zap', 'vivareal']),
  custom_urls: z
    .array(z.string().url('URL inválida.').max(500))
    .max(10, 'Máximo de 10 URLs customizadas.')
    .default([]),
});

export type CreateBriefingInput = z.infer<typeof createBriefingSchema>;
