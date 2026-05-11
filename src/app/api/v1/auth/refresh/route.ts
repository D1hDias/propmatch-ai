import type { NextRequest } from 'next/server';
import { refresh } from '@/server/auth/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError, setRefreshCookie, REFRESH_COOKIE } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const rawToken = req.cookies.get(REFRESH_COOKIE)?.value;

    if (!rawToken) {
      throw new AppError(
        'TOKEN_INVALID',
        'No refresh token cookie present',
        'Sessão inválida. Faça login novamente.',
        401,
      );
    }

    const tokens = await refresh(rawToken);

    const response = apiSuccess({ access_token: tokens.accessToken });
    return setRefreshCookie(response, tokens.refreshToken);
  } catch (err) {
    return apiError(err);
  }
}
