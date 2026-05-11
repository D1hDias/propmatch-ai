import type { NextRequest } from 'next/server';
import { signupSchema } from '@/lib/schemas/auth';
import { signup } from '@/server/auth/service';
import { AppError } from '@/server/lib/errors';
import { apiSuccess, apiError, setRefreshCookie } from '@/server/lib/response';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request validation failed',
        'Verifique os campos e tente novamente.',
        400,
        { field_errors: parsed.error.flatten().fieldErrors },
      );
    }

    const { user, tokens } = await signup(parsed.data);

    const response = apiSuccess({ user, access_token: tokens.accessToken }, 201);
    return setRefreshCookie(response, tokens.refreshToken);
  } catch (err) {
    return apiError(err);
  }
}
