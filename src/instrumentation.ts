export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production') {
      await import('../sentry.server.config');
    }

    // Pre-load IBGE city cache (all 5571 Brazilian municipalities → state UF)
    const { preloadCityCache } = await import('@/server/search/city-lookup');
    void preloadCityCache().catch(() => {
      // Non-fatal: URL builder falls back to 'sp' for unknown cities
    });

    // Reset syncs left in 'running' state from a previous server instance.
    // Any running sync is orphaned after a restart — BullMQ workers don't survive.
    const { prisma } = await import('@/server/db/client');
    await prisma.partnerSite.updateMany({
      where: { syncStatus: 'running' },
      data: { syncStatus: 'idle' },
    }).catch(() => {});

    // Start BullMQ workers — runs once per Node.js process lifetime
    const { startSearchWorker } = await import('@/server/search/queue');
    const { startHitlWorker } = await import('@/server/briefings/hitl-queue');
    const { startExportWorker } = await import('@/server/lgpd/export-queue');
    const { startSyncWorker, startSyncScheduler } = await import('@/server/partners/sync-queue');
    startSearchWorker();
    startHitlWorker();
    startExportWorker();
    startSyncWorker();
    startSyncScheduler();
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
