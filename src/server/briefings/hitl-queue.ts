import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/db/client';

// ---------------------------------------------------------------------------
// BRF-5: HITL queue — human-in-the-loop review for low-confidence briefings
//
// Flow:
//   1. briefing/service.ts enqueues a job when confidence < 0.85
//   2. Worker logs the review request and updates HitlMetric.queuedAt
//   3. Admin calls PATCH /api/v1/briefings/{id}/review to resolve
//   4. Resolution handler updates briefing.reviewStatus + HitlMetric.reviewedAt
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function redisConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

const connection = redisConnection();

export const hitlQueue = new Queue('hitl', { connection });

export interface HitlJobData {
  briefingId: string;
  userId: string;
  confidence: number;
  missingFields: string[];
}

let workerStarted = false;

export function startHitlWorker(): void {
  if (workerStarted) return;
  workerStarted = true;

  const worker = new Worker<HitlJobData>(
    'hitl',
    async (job: Job<HitlJobData>) => {
      const { briefingId, confidence, missingFields } = job.data;

      logger.info('hitl review requested', {
        briefingId,
        jobId: job.id,
        confidence,
        missingFields,
      });

      // Ensure HitlMetric row exists (service.ts may have created it already)
      const existing = await prisma.hitlMetric.findFirst({ where: { briefingId } });
      if (!existing) {
        await prisma.hitlMetric.create({ data: { briefingId } });
      }

      // Alert if queue is backing up (SLA alarm at 50 pending — see CLAUDE.md gotchas)
      const pending = await hitlQueue.getWaitingCount();
      if (pending > 50) {
        logger.error('hitl queue depth exceeded threshold', { pending, threshold: 50 });
      }
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error('hitl worker job failed', { jobId: job?.id, error: err });
  });
}
