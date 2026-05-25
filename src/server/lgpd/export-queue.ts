import 'server-only';
import { Queue, Worker, type Job } from 'bullmq';
import { logger } from '@/server/lib/logger';
import { executeExport } from './export-service';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function redisConnection() {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

export interface ExportJobData {
  jobId: string;
  userId: string;
}

export const exportQueue = new Queue<ExportJobData>('lgpd-export', {
  connection: redisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export function startExportWorker(): Worker<ExportJobData> {
  const worker = new Worker<ExportJobData>(
    'lgpd-export',
    async (job: Job<ExportJobData>) => {
      logger.info('lgpd.export_worker: starting', { jobId: job.data.jobId });
      await executeExport(job.data.jobId);
      logger.info('lgpd.export_worker: completed', { jobId: job.data.jobId });
    },
    {
      connection: redisConnection(),
      concurrency: 2, // ZIP assembly is CPU+memory bound — cap at 2
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('lgpd.export_worker: job failed', {
      jobId: job?.data.jobId,
      error: (err as Error).message,
    });
  });

  return worker;
}
