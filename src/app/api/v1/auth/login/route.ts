import type { NextRequest } from 'next/server';
import { loginSchema } from '@/lib/schemas/auth';
import { login } from '@/server/auth/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError, setRefreshCookie } from '@/server/lib/response';

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request validation failed',
        'E-mail ou senha inválidos.',
        400,
        { field_errors: parsed.error.flatten().fieldErrors },
      );
    }

    const { user, tokens } = await login(parsed.data);

    const response = apiSuccess({ user, access_token: tokens.accessToken });
    return setRefreshCookie(response, tokens.refreshToken);
  } catch (err) {
    return apiError(err);
  }
}
