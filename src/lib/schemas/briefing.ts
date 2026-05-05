import { z } from 'zod';

export const createBriefingSchema = z.object({
  raw_text: z
    .string()
    .min(10, 'Briefing deve ter pelo menos 10 caracteres.')
    .max(2000, 'Briefing não pode ultrapassar 2000 caracteres.')
    .trim(),
  client_id: z.string().uuid().optional(),
});

export type CreateBriefingInput = z.infer<typeof createBriefingSchema>;
