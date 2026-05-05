import 'server-only';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

type GlobalWithPrisma = typeof globalThis & { prisma?: PrismaClient };
const g = globalThis as GlobalWithPrisma;

export const prisma: PrismaClient = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

type TransactionClient = Prisma.TransactionClient;

/**
 * RLS-aware transaction wrapper — every authenticated route handler must use this.
 * Sets app.current_user_id (UUID) and app.current_user_role for Postgres RLS policies.
 * Policies are defined in migration auth3; functions current_app_user() / current_app_role()
 * read these session variables. See docs/adr/0005-rls-pattern.md.
 */
export async function withRlsContext<T>(
  userId: string,
  userRole: string,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // Cast to uuid explicitly so Postgres doesn't reject the text literal.
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_role', ${userRole}, true)`;
    return fn(tx);
  });
}
