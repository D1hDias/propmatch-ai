import 'server-only';

// Prisma client is instantiated here and shared across requests via the global singleton.
// PrismaClient types are generated when models are added in AUTH-1.
// Run: pnpm exec prisma generate   (after AUTH-1 adds models to schema.prisma)

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require('@prisma/client');

type GlobalWithPrisma = typeof globalThis & { prisma?: typeof PrismaClient.prototype };
const g = globalThis as GlobalWithPrisma;

// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
export const prisma: typeof PrismaClient.prototype = g.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

/**
 * RLS-aware transaction wrapper — every route handler must use this.
 * Sets app.current_user_id and app.current_user_role for Postgres RLS policies.
 * Full implementation (type-safe with generated models) lands in AUTH-3.
 */
export async function withRlsContext<T>(
  userId: string,
  userRole: string,
  fn: (tx: typeof PrismaClient.prototype) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return await prisma.$transaction(async (tx: typeof PrismaClient.prototype) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$executeRaw`SET LOCAL app.current_user_id = ${userId}`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await tx.$executeRaw`SET LOCAL app.current_user_role = ${userRole}`;
    return fn(tx);
  });
}
