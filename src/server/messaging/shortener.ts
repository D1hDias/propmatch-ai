import 'server-only';
import { prisma } from '@/server/db/client';

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 7;

function randomSlug(): string {
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_CHARS[Math.floor(Math.random() * SLUG_CHARS.length)];
  }
  return slug;
}

/**
 * Creates a short link and returns the short URL.
 * Retries once on slug collision (astronomically unlikely at current scale).
 */
export async function createShortLink(
  targetUrl: string,
  messageId?: string,
): Promise<string> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = randomSlug();
    try {
      await prisma.shortLink.create({
        data: { slug, targetUrl, messageId: messageId ?? null },
      });
      return `${baseUrl}/r/${slug}`;
    } catch (err: unknown) {
      // Unique constraint violation — retry with a new slug
      if (
        err instanceof Error &&
        err.message.includes('unique constraint') // Prisma wraps PG unique violation
      ) {
        continue;
      }
      throw err;
    }
  }

  // Fallback: return original URL if all slugs collide (should never happen in practice)
  return targetUrl;
}
