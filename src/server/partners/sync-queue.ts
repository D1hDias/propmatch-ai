import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/db/client';
import { syncSite } from './site-sync';

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

export interface SyncJobData {
  partnerSiteId: string;
}

export const syncQueue = new Queue<SyncJobData>('partner-sync', { connection });

/**
 * Enqueue a background sync for one partner site.
 * Jobs use auto-generated IDs (no fixed jobId) so re-triggering always works.
 * Concurrency is controlled by the worker's syncStatus==='running' guard.
 */
export async function enqueueSiteSync(partnerSiteId: string): Promise<void> {
  await syncQueue.add(
    'sync',
    { partnerSiteId },
    { removeOnComplete: 50, removeOnFail: 25 },
  );
  logger.info('sync_enqueued', { partnerSiteId });
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

let syncWorkerStarted = false;

export function startSyncWorker(): void {
  if (syncWorkerStarted) return;
  syncWorkerStarted = true;

  const worker = new Worker<SyncJobData>(
    'partner-sync',
    async (job: Job<SyncJobData>) => {
      const { partnerSiteId } = job.data;

      const site = await prisma.partnerSite.findUnique({ where: { id: partnerSiteId } });
      if (!site) {
        logger.warn('sync_job_site_not_found', { partnerSiteId });
        return;
      }

      // Skip if another sync is already running for this site (e.g. admin-triggered)
      if (site.syncStatus === 'running') {
        logger.info('sync_job_already_running', { partnerSiteId, domain: site.domain });
        return;
      }

      logger.info('sync_job_start', { partnerSiteId, domain: site.domain });
      const result = await syncSite(site);
      logger.info('sync_job_done', { partnerSiteId, domain: site.domain, ...result });
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    logger.error('sync worker job failed', { jobId: job?.id, error: err });
  });
}

// ---------------------------------------------------------------------------
// Scheduler — ticks every hour via setInterval, enqueues syncs for due sites.
// Interval controlled by SYNC_INTERVAL_HOURS env (default: 24).
// setInterval is simpler than BullMQ repeatable jobs and works reliably in both
// Next.js dev (HMR) and production (systemd).
// ---------------------------------------------------------------------------

const SYNC_INTERVAL_MS = (Number(process.env.SYNC_INTERVAL_HOURS ?? 24)) * 60 * 60 * 1000;
const SCHEDULER_TICK_MS = 60 * 60 * 1000; // check every hour

let schedulerStarted = false;

async function runSchedulerTick(): Promise<void> {
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MS);
  try {
    const sites = await prisma.partnerSite.findMany({
      where: {
        active: true,
        syncStatus: { not: 'running' },
        consecutiveFailures: { lt: 5 },
        OR: [
          { lastScrapedAt: null },
          { lastScrapedAt: { lt: cutoff } },
        ],
      },
      select: { id: true, domain: true },
    });

    for (const site of sites) {
      await enqueueSiteSync(site.id);
    }

    logger.info('sync_scheduler_tick', { due: sites.length, intervalHours: SYNC_INTERVAL_MS / 3_600_000 });
  } catch (err) {
    logger.error('sync_scheduler_tick_error', { error: String(err) });
  }
}

export function startSyncScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => { void runSchedulerTick(); }, SCHEDULER_TICK_MS);
  logger.info('sync_scheduler_started', { tickEveryHours: 1, syncIntervalHours: SYNC_INTERVAL_MS / 3_600_000 });
}
