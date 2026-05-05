/**
 * AUTH-3 — RLS isolation tests.
 *
 * These tests require a live Postgres instance with migrations applied.
 * Run with: DATABASE_URL=... pnpm exec vitest run tests/integration/rls.test.ts
 *
 * They verify the core tenant isolation guarantee: broker A cannot read broker B's rows
 * even if the application code passes the wrong user_id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setRlsContext(userId: string, role = 'broker') {
  await prisma.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
  await prisma.$executeRaw`SELECT set_config('app.current_user_role', ${role}, true)`;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let userAId: string;
let userBId: string;

const BASE_USER = {
  name: 'Test User',
  passwordHash: '$argon2id$test',
  lgpdConsentAt: new Date(),
};

beforeAll(async () => {
  // Clean up any leftover test rows from previous runs
  await prisma.user.deleteMany({
    where: { email: { in: ['rls_a@test.local', 'rls_b@test.local'] } },
  });

  // Create two brokers — must be done outside RLS context (service role path)
  const userA = await prisma.user.create({
    data: { ...BASE_USER, email: 'rls_a@test.local' },
  });
  const userB = await prisma.user.create({
    data: { ...BASE_USER, email: 'rls_b@test.local' },
  });
  userAId = userA.id;
  userBId = userB.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userAId, userBId] } },
  });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RLS — users table isolation', () => {
  it('broker A sees only their own user row', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userAId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_role', 'broker', true)`;

      const rows = await tx.user.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(userAId);
    });
  });

  it('broker B cannot see broker A row', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userBId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_role', 'broker', true)`;

      const row = await tx.user.findUnique({ where: { id: userAId } });
      expect(row).toBeNull();
    });
  });

  it('admin role sees all users', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userAId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_role', 'admin', true)`;

      const rows = await tx.user.findMany({
        where: { id: { in: [userAId, userBId] } },
      });
      expect(rows).toHaveLength(2);
    });
  });
});

describe('RLS — lgpd_jobs table isolation', () => {
  it('broker A cannot see lgpd_jobs of broker B', async () => {
    // Create a job as broker B (service role — no RLS context)
    const job = await prisma.lgpdJob.create({
      data: { userId: userBId, jobType: 'delete' },
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userAId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_role', 'broker', true)`;

      const found = await tx.lgpdJob.findUnique({ where: { id: job.id } });
      expect(found).toBeNull();
    });

    // Cleanup
    await prisma.lgpdJob.delete({ where: { id: job.id } });
  });
});
