import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/context';
import { apiError } from '@/server/lib/response';
import { getPartnerSite } from '@/server/partners';
import { syncSite } from '@/server/partners/site-sync';

export const dynamic = 'force-dynamic';

// GET /api/v1/partner-sites/:id/sync/stream
// Runs a full inventory sync inline and streams progress via SSE.
// The caller receives `data: <json>\n\n` events while sync is running,
// and a final `data: {"done":true,...SyncResult}\n\n` when complete.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const site = await getPartnerSite(id);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Client disconnected — swallow write errors
          }
        };

        try {
          const result = await syncSite(site, (e) => send(e));
          send({ done: true, ...result });
        } catch (err) {
          send({ error: String(err) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
