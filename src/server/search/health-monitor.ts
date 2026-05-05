import 'server-only';
import { logger } from '@/server/lib/logger';
import type { HealthStatus, SourceAdapter } from './types';

const POLL_INTERVAL_MS = 60_000;
const SOURCE_HEALTH_TTL_MS = 90_000; // stale after 90s

interface CachedHealth {
  status: HealthStatus;
  cachedAt: number;
}

const healthCache = new Map<string, CachedHealth>();
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startHealthMonitor(adapters: SourceAdapter[]): void {
  if (intervalId) return; // already running

  // Run immediately on first call
  void pollAll(adapters);

  intervalId = setInterval(() => {
    void pollAll(adapters);
  }, POLL_INTERVAL_MS);
}

export function stopHealthMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function pollAll(adapters: SourceAdapter[]): Promise<void> {
  await Promise.allSettled(adapters.map((a) => pollOne(a)));
}

async function pollOne(adapter: SourceAdapter): Promise<void> {
  try {
    const status = await adapter.healthCheck();
    healthCache.set(adapter.name, { status, cachedAt: Date.now() });

    if (!status.healthy) {
      logger.warn('source health degraded', {
        source: adapter.name,
        successRate: status.successRate,
        message: status.message,
      });
    }
  } catch (err) {
    const degraded: HealthStatus = {
      source: adapter.name,
      healthy: false,
      successRate: 0,
      lastCheckedAt: new Date().toISOString(),
      message: `Health check threw: ${String(err)}`,
    };
    healthCache.set(adapter.name, { status: degraded, cachedAt: Date.now() });
    logger.error('source health check failed', { source: adapter.name, error: err });
  }
}

export function getSourceHealth(source: string): HealthStatus | null {
  const cached = healthCache.get(source);
  if (!cached) return null;
  // Return null if stale — caller treats as unknown
  if (Date.now() - cached.cachedAt > SOURCE_HEALTH_TTL_MS) return null;
  return cached.status;
}

export function getAllSourceHealth(): HealthStatus[] {
  return Array.from(healthCache.values()).map((c) => c.status);
}
