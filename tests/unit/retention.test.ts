// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma before importing the job module
vi.mock('@/server/db/client', () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(3),
    lgpdJob: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    auditLog: {
      deleteMany: vi.fn().mockResolvedValue({ count: 10 }),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { runRetentionJob } from '@/server/jobs/retention';
import { prisma } from '@/server/db/client';

describe('runRetentionJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('purges raw_text, lgpd_jobs e audit_log e retorna contagens corretas', async () => {
    const result = await runRetentionJob();

    expect(result.rawTextPurged).toBe(3);
    expect(result.lgpdJobsCleaned).toBe(2);
    expect(result.auditLogCleaned).toBe(10);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('loga o resultado em audit_log após execução', async () => {
    await runRetentionJob();

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'ops.retention_job_completed',
        }),
      }),
    );
  });

  it('só deleta lgpd_jobs com status completed ou failed', async () => {
    await runRetentionJob();

    expect(prisma.lgpdJob.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['completed', 'failed'] },
        }),
      }),
    );
  });
});
