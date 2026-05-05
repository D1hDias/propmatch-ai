import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';

// GET /api/v1/briefings/{id}/stream
//
// Server-Sent Events — streams search progress to the browser.
// Events:
//   status_update  { status: BriefingStatus }
//   result_chunk   { listings: NormalizedListing[] }   (batches of results)
//   search_complete { total: number, durationMs: number }
//   search_error   { message: string }
//
// Closes automatically on search_complete or search_error.
// SSE connections count toward broker concurrency cap (handled in middleware).

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx;
  try {
    ctx = await requireAuth(req);
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;

  const encoder = new TextEncoder();

  function event(type: string, data: unknown): Uint8Array {
    const id = `${Date.now()}`;
    return encoder.encode(
      `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const POLL_INTERVAL = 1000; // 1s
      const MAX_WAIT_MS = 60_000; // 60s max
      const started = Date.now();
      let lastResultCount = 0;

      try {
        // Verify briefing belongs to this user
        const briefing = await prisma.briefing.findFirst({
          where: { id, userId: ctx.sub },
        });

        if (!briefing) {
          throw new AppError(
            'RESOURCE_NOT_FOUND',
            `Briefing ${id} not found`,
            'Briefing não encontrado.',
            404,
          );
        }

        controller.enqueue(event('status_update', { status: briefing.status }));

        // Poll for results
        while (Date.now() - started < MAX_WAIT_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL));

          const current = await prisma.briefing.findFirst({
            where: { id, userId: ctx.sub },
          });

          if (!current) break;

          // Check for new property_sources linked via briefing_results (Sprint 4 adds this)
          // For now we poll the briefing status and return all properties from the last search
          const properties = await prisma.property.findMany({
            where: {
              active: true,
              city: { contains: extractCity(current.extractedCriteria), mode: 'insensitive' },
            },
            include: { sources: { orderBy: { scrapedAt: 'desc' }, take: 1 } },
            orderBy: { lastSeenAt: 'desc' },
            take: 50,
          });

          if (properties.length > lastResultCount) {
            const newListings = properties.slice(lastResultCount);
            controller.enqueue(
              event('result_chunk', {
                listings: newListings.map((p) => ({
                  id: p.id,
                  title: p.sources[0]?.title ?? '',
                  url: p.sources[0]?.url ?? '',
                  photos: p.sources[0]?.photos ?? [],
                  description: p.sources[0]?.description ?? '',
                  neighborhood: p.neighborhood,
                  city: p.city,
                  price: Number(p.price),
                  priceType: p.priceType,
                  bedrooms: p.bedrooms,
                  bathrooms: p.bathrooms,
                  areaSqm: p.areaSqm ? Number(p.areaSqm) : null,
                  parkingSpots: p.parkingSpots,
                  furnished: p.furnished,
                  amenities: (p.amenities as string[]) ?? [],
                  extractedAmenities: (p.extractedAmenities as Record<string, boolean>) ?? {},
                  source: p.sources[0]?.source ?? 'zap',
                })),
              }),
            );
            lastResultCount = properties.length;
          }

          if (current.status === 'ready') {
            controller.enqueue(
              event('search_complete', {
                total: lastResultCount,
                durationMs: Date.now() - started,
              }),
            );
            break;
          }

          if (current.status === 'failed') {
            controller.enqueue(
              event('search_error', { message: 'Busca falhou. Tente novamente.' }),
            );
            break;
          }
        }

        if (Date.now() - started >= MAX_WAIT_MS) {
          controller.enqueue(
            event('search_error', { message: 'Tempo limite de espera atingido.' }),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro interno.';
        controller.enqueue(event('search_error', { message: msg }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx/Caddy buffering
    },
  });
}

function extractCity(criteria: unknown): string {
  if (criteria && typeof criteria === 'object' && 'city' in criteria) {
    return String((criteria as Record<string, unknown>).city ?? '');
  }
  return '';
}
