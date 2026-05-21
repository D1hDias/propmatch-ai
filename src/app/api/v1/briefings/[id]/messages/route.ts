import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/server/auth/context';
import { withRlsContext, prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError } from '@/server/lib/response';
import { formatWhatsAppMessage, formatPartnerMessage } from '@/server/messaging/format';
import { createShortLink } from '@/server/messaging/shortener';
import { requirePlan } from '@/server/auth/gates';
import { logger } from '@/server/lib/logger';

export const dynamic = 'force-dynamic';

const propertyForMessageSchema = z.object({
  propertyId: z.string().uuid(),
  personalNote: z.string().max(500).nullable().optional(),
});

const bodySchema = z.object({
  target: z.enum(['client', 'partner']).default('client'),
  selectedProperties: z.array(propertyForMessageSchema).min(1).max(20),
});

// POST /api/v1/briefings/:id/messages
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id: briefingId } = await params;

    requirePlan(ctx, 'starter'); // Free users cannot generate messages

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        parsed.error.message,
        'Dados inválidos na requisição.',
        400,
      );
    }
    const { selectedProperties, target } = parsed.data;

    const propertyIds = selectedProperties.map((p) => p.propertyId);

    // Load briefing + results under RLS — ownership enforced by the session context
    const loaded = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
      const briefing = await tx.briefing.findUnique({
        where: { id: briefingId },
        include: {
          client: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      });
      if (!briefing) return null;
      const results = await tx.briefingResult.findMany({
        where: { briefingId, propertyId: { in: propertyIds } },
        include: {
          property: {
            include: { sources: { orderBy: { scrapedAt: 'desc' }, take: 1 } },
          },
        },
      });
      return { briefing, results };
    });

    if (!loaded) {
      throw new AppError(
        'RESOURCE_NOT_FOUND',
        `Briefing ${briefingId} not found`,
        'Briefing não encontrado.',
        404,
      );
    }

    const { briefing, results } = loaded;

    if (briefing.status !== 'ready') {
      throw new AppError(
        'RESOURCE_CONFLICT',
        `Briefing ${briefingId} is not ready (status=${briefing.status})`,
        'O briefing ainda não está pronto para gerar mensagem.',
        409,
      );
    }

    if (results.length === 0) {
      throw new AppError(
        'RESOURCE_NOT_FOUND',
        'No matching briefing results found for given propertyIds',
        'Nenhum imóvel selecionado encontrado neste briefing.',
        404,
      );
    }

    // Build ordered list matching selectedProperties order
    const noteByPropertyId = new Map(
      selectedProperties.map((p) => [p.propertyId, p.personalNote ?? null]),
    );
    const orderedResults = propertyIds
      .map((pid) => results.find((r) => r.propertyId === pid))
      .filter((r): r is NonNullable<typeof r> => r !== undefined);

    const propertiesForMessage = orderedResults.map((r) => {
      const src = r.property.sources[0];
      return {
        id: r.propertyId,
        title: src?.title ?? null,
        propertyType: r.property.propertyType,
        bedrooms: r.property.bedrooms,
        bathrooms: r.property.bathrooms,
        areaSqm: r.property.areaSqm ? Number(r.property.areaSqm) : null,
        parkingSpots: r.property.parkingSpots,
        neighborhood: r.property.neighborhood,
        city: r.property.city,
        price: Number(r.property.price),
        priceType: r.property.priceType,
        url: src?.url ?? '',
        personalNote: noteByPropertyId.get(r.propertyId) ?? null,
      };
    });

    // Create short links for each property URL
    const shortLinkMap = new Map<string, string>();
    await Promise.all(
      propertiesForMessage.map(async (p) => {
        if (p.url) {
          const shortUrl = await createShortLink(p.url);
          shortLinkMap.set(p.url, shortUrl);
        }
      }),
    );

    let formattedText: string;

    if (target === 'partner') {
      // For partner messages, generate one message per selected property
      // (broker will send individually to each partner). Use first property.
      const firstProp = propertiesForMessage[0];
      if (!firstProp) throw new AppError('VALIDATION_FAILED', 'No property', 'Nenhum imóvel.', 400);

      // Build a concise client profile summary from extracted criteria (new nested schema)
      const criteria = briefing.extractedCriteria as { location?: { city?: string; neighborhoods?: string[] }; hard_filters?: { bedrooms_min?: number; price_max?: number }; intent?: string } | null;
      const profileParts: string[] = [];
      if (criteria?.hard_filters?.bedrooms_min) profileParts.push(`${criteria.hard_filters.bedrooms_min}+ quartos`);
      if (criteria?.hard_filters?.price_max) profileParts.push(`até R$ ${Number(criteria.hard_filters.price_max).toLocaleString('pt-BR')}`);
      if (criteria?.location?.neighborhoods?.[0]) profileParts.push(criteria.location.neighborhoods[0]);
      if (criteria?.location?.city) profileParts.push(`${criteria.location.city}`);
      if (criteria?.intent === 'buy') profileParts.push('compra');
      if (criteria?.intent === 'rent') profileParts.push('locação');
      const clientProfile = profileParts.length > 0
        ? profileParts.join(', ')
        : `interessado em ${briefing.client.name}`;

      // Generate one message per property (concatenated with separator for multiple)
      formattedText = propertiesForMessage.map((p) =>
        formatPartnerMessage({
          brokerName: briefing.user.name,
          property: {
            ...p,
            price: Number(p.price),
            url: shortLinkMap.get(p.url) ?? p.url,
            personalNote: p.personalNote ?? undefined,
          },
          clientProfile,
        })
      ).join('\n\n---\n\n');
    } else {
      formattedText = formatWhatsAppMessage({
        clientName: briefing.client.name,
        brokerName: briefing.user.name,
        properties: propertiesForMessage,
        shortener: (url) => shortLinkMap.get(url) ?? url,
      });
    }

    // Persist message record under RLS
    const message = await withRlsContext(ctx.sub, ctx.role, (tx) =>
      tx.message.create({
        data: {
          briefingId,
          clientId: briefing.clientId,
          formattedText,
          deliveryMethod: 'clipboard',
          deliveryStatus: 'pending',
        },
        select: {
          id: true,
          briefingId: true,
          clientId: true,
          formattedText: true,
          deliveryMethod: true,
          deliveryStatus: true,
          createdAt: true,
        },
      }),
    );

    // Back-fill messageId on short links — non-critical side effect, log on failure
    prisma.shortLink.updateMany({
      where: { targetUrl: { in: propertiesForMessage.map((p) => p.url) }, messageId: null },
      data: { messageId: message.id },
    }).catch((err: unknown) => logger.warn('shortLink messageId backfill failed', { messageId: message.id, error: String(err) }));

    return apiSuccess(message, 201);
  } catch (err) {
    return apiError(err);
  }
}
