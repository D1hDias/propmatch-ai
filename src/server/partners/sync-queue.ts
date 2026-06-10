import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/db/client';
import { syncSite } from './site-sync';
import { discoverPartnerSite } from './discovery';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function redisConnection() {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
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

      // Auto-discovery: if strategy is not set and discovery has never run, detect platform first.
      // This covers sites freshly created by brokers — they sync immediately without manual discovery.
      if (!site.discoveryStrategy && !site.lastDiscoveredAt) {
        logger.info('sync_job_auto_discovery', { partnerSiteId, domain: site.domain });
        try {
          await discoverPartnerSite(site);
          // Re-fetch to get the updated strategy before syncing
          const refreshed = await prisma.partnerSite.findUnique({ where: { id: partnerSiteId } });
          if (refreshed) {
            logger.info('sync_job_start', { partnerSiteId, domain: refreshed.domain, strategy: refreshed.discoveryStrategy });
            const result = await syncSite(refreshed);
            logger.info('sync_job_done', { partnerSiteId, domain: refreshed.domain, ...result });
            return;
          }
        } catch (err) {
          logger.warn('sync_job_auto_discovery_failed', { partnerSiteId, domain: site.domain, error: String(err) });
          // Discovery failed — proceed with map_then_scrape fallback
        }
      }

      logger.info('sync_job_start', { partnerSiteId, domain: site.domain, strategy: site.discoveryStrategy });
      const result = await syncSite(site);
      logger.info('sync_job_done', { partnerSiteId, domain: site.domain, ...result });
    },
    { connection, concurrency: 3 },
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

// Nightly window: only run recurring syncs between SYNC_WINDOW_START_BRT and SYNC_WINDOW_END_BRT
// (America/Sao_Paulo). Defaults: 01h–05h BRT. New-site enqueues bypass this window entirely.
const SYNC_WINDOW_START = Number(process.env.SYNC_WINDOW_START_BRT ?? 1);
const SYNC_WINDOW_END   = Number(process.env.SYNC_WINDOW_END_BRT   ?? 5);

function isInsideSyncWindow(): boolean {
  const nowBRT = new Date().toLocaleString('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo',
  });
  const hour = Number(nowBRT);
  return hour >= SYNC_WINDOW_START && hour < SYNC_WINDOW_END;
}

let schedulerStarted = false;

async function runSchedulerTick(): Promise<void> {
  if (!isInsideSyncWindow()) return; // outside nightly window — skip

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
