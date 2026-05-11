import type { NextRequest } from 'next/server';
import { logout } from '@/server/auth/service';
import { apiSuccess, apiError, clearRefreshCookie, REFRESH_COOKIE } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const rawToken = req.cookies.get(REFRESH_COOKIE)?.value;

    if (rawToken) {
      await logout(rawToken);
    }

    // Always clear the cookie and return 200, even if no token was present.
    const response = apiSuccess({ ok: true });
    return clearRefreshCookie(response);
  } catch (err) {
    return apiError(err);
  }
}
