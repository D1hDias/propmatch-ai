import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { verifyAccessToken } from '@/server/auth/jwt';
import { prisma } from '@/server/db/client';
import { AppError } from '@/server/lib/errors';

export const dynamic = 'force-dynamic';

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
  // EventSource doesn't support custom headers — accept token via query param as fallback
  let ctx;
  try {
    const tokenFromQuery = req.nextUrl.searchParams.get('token');
    ctx = tokenFromQuery
      ? await verifyAccessToken(tokenFromQuery)
      : await requireAuth(req);
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
      const MAX_WAIT_MS = 180_000; // 3 min — Firecrawl MAP+scrape can take 60-120s
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

        // Skip initial delay when briefing is already in a terminal state — deliver results immediately
        const alreadyDone = briefing.status === 'ready' || briefing.status === 'failed';

        // Poll for results
        let firstPoll = true;
        while (Date.now() - started < MAX_WAIT_MS) {
          if (!firstPoll || !alreadyDone) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          }
          firstPoll = false;

          const current = await prisma.briefing.findFirst({
            where: { id, userId: ctx.sub },
          });

          if (!current) break;

          // Query via briefing_results for accurate rank/fitScore ordering
          const results = await prisma.briefingResult.findMany({
            where: { briefingId: id },
            orderBy: { rank: 'asc' },
            take: 50,
            include: {
              property: {
                include: { sources: { orderBy: { scrapedAt: 'desc' }, take: 1 } },
              },
            },
          });

          if (results.length > lastResultCount) {
            const newResults = results.slice(lastResultCount);
            controller.enqueue(
              event('result_chunk', {
                listings: newResults.map((r) => ({
                  id: r.property.id,
                  title: r.property.sources[0]?.title ?? '',
                  url: r.property.sources[0]?.url ?? '',
                  photos: r.property.sources[0]?.photos ?? [],
                  description: r.property.sources[0]?.description ?? '',
                  neighborhood: r.property.neighborhood,
                  city: r.property.city,
                  price: Number(r.property.price),
                  priceType: r.property.priceType,
                  bedrooms: r.property.bedrooms,
                  bathrooms: r.property.bathrooms,
                  areaSqm: r.property.areaSqm ? Number(r.property.areaSqm) : null,
                  parkingSpots: r.property.parkingSpots,
                  furnished: r.property.furnished,
                  amenities: (r.property.amenities as string[]) ?? [],
                  extractedAmenities: (r.property.extractedAmenities as Record<string, boolean>) ?? {},
                  source: r.property.sources[0]?.source ?? 'portal_x',
                  fitScore: r.fitScore,
                })),
              }),
            );
            lastResultCount = results.length;
          }

          if (current.status === 'ready') {
            const meta = (
              current.extractedCriteria &&
              typeof current.extractedCriteria === 'object'
                ? current.extractedCriteria
                : {}
            ) as Record<string, unknown>;

            controller.enqueue(
              event('search_complete', {
                total: lastResultCount,
                durationMs: Date.now() - started,
                widenProposals: meta['_widenProposals'] ?? [],
                customUrlResults: meta['_customUrlResults'] ?? [],
                belowThresholdCount: meta['_belowThresholdCount'] ?? 0,
              }),
            );
            break;
          }

          if (current.status === 'failed') {
            // If we already have results (search partially completed before failure), treat as done
            if (lastResultCount > 0) {
              controller.enqueue(
                event('search_complete', {
                  total: lastResultCount,
                  durationMs: Date.now() - started,
                  widenProposals: [],
                  customUrlResults: [],
                }),
              );
            } else {
              controller.enqueue(
                event('search_error', { message: 'Busca falhou. Tente novamente.' }),
              );
            }
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

