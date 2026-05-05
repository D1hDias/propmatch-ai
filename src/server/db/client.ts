import 'server-only';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

type GlobalWithPrisma = typeof globalThis & { prisma?: PrismaClient };
const g = globalThis as GlobalWithPrisma;

export const prisma: PrismaClient = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

type TransactionClient = Prisma.TransactionClient;

/**
 * RLS-aware transaction wrapper — every route handler must use this.
 * Sets app.current_user_id and app.current_user_role for Postgres RLS policies.
 * RLS policies themselves are wired in AUTH-3.
 */
export async function withRlsContext<T>(
  userId: string,
  userRole: string,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL app.current_user_id = ${userId}`;
    await tx.$executeRaw`SET LOCAL app.current_user_role = ${userRole}`;
    return fn(tx);
  });
}
