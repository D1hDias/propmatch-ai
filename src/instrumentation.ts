export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');

    // Start BullMQ workers — runs once per Node.js process lifetime
    const { startSearchWorker } = await import('@/server/search/queue');
    const { startHitlWorker } = await import('@/server/briefings/hitl-queue');
    const { startExportWorker } = await import('@/server/lgpd/export-queue');
    startSearchWorker();
    startHitlWorker();
    startExportWorker();
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
