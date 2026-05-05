# CLAUDE.md — auth-svc

Service-specific operating manual for `services/auth-svc`. Read this in addition to the root [CLAUDE.md](../../CLAUDE.md).

## Service responsibility

`auth-svc` owns everything about who a user is and whether they have consented to data processing. Concretely:

- Signup, login, logout, refresh.
- Password hashing (argon2id) and verification.
- JWT issuance and rotation.
- LGPD consent capture and the deletion endpoint.
- OAuth (Google) — Sprint 2.
- Audit logging for all auth-related events.

What this service does **not** own:
- User-scoped business data (briefings, clients, properties). Those live in their respective services.
- Tier and billing state. The `users.plan` column is updated by webhook handlers in a separate billing context (Sprint 6+); auth-svc only reads it.
- Session data beyond refresh tokens. There is no server-side session store.

## Tech stack

- **Runtime:** Node.js 20 LTS
- **Framework:** Fastify 4
- **Database:** PostgreSQL 16 via Prisma client (the source of truth for schema lives in `prisma/schema.prisma` at the repo root)
- **Cache / rate limiter:** Redis 7
- **Validation:** zod
- **Password hashing:** `@node-rs/argon2`
- **JWT:** `jose`
- **Test:** Vitest + supertest
- **Observability:** Datadog APM auto-instrumentation + Sentry

## Directory layout

```
services/auth-svc/
├── src/
│   ├── server.ts              Fastify app setup, plugin registration
│   ├── routes/                One file per route group
│   │   ├── auth.routes.ts     /signup, /login, /logout, /refresh
│   │   ├── lgpd.routes.ts     /lgpd/delete, /lgpd/delete/cancel
│   │   └── health.routes.ts   /healthz, /readyz
│   ├── handlers/              Business logic per endpoint
│   ├── services/              Reusable domain services (PasswordService, TokenService, AuditService)
│   ├── repos/                 Database access (thin wrapper over Prisma)
│   ├── schemas/               zod schemas for validation
│   ├── middleware/            Auth, rate limit, transaction-with-RLS-vars
│   ├── errors/                AppError + domain error subclasses
│   └── config/                Env loading and validation
├── tests/
│   ├── unit/                  next to source files where possible
│   ├── integration/           HTTP-level tests against real DB
│   └── factories/             user, session, lgpd_job factories
├── package.json
└── tsconfig.json
```

## Endpoints (current and Sprint 1)

### `POST /api/v1/auth/signup`

- Validates: email, name, phone, password, lgpd_consent (must be `true`).
- Creates: `users` row with `lgpd_consent_at = now()`.
- Returns: 201 + access token (1h) + refresh cookie (30d).
- Rate limit: 5 per IP per hour.
- Audit log: `user.signup`.

### `POST /api/v1/auth/login`

- Validates: email, password.
- Verifies password with argon2id (constant time on miss path).
- Returns: 200 + access token + refresh cookie. Or 401 with `INVALID_CREDENTIALS` (same response for unknown email and wrong password).
- Rate limit: 10 per email per 15 minutes; account lockout 10 minutes after 10 failures.
- Audit log: `user.login` (success) or `user.login_failed` (failure with reason).

### `POST /api/v1/auth/refresh`

- Reads refresh token from httpOnly cookie.
- Verifies token is not revoked, not expired.
- Rotates: issues a new refresh token, marks the old one revoked atomically.
- Returns: 200 + new access token + new refresh cookie.
- Rate limit: 60 per token per hour.

### `POST /api/v1/auth/logout`

- Revokes the current refresh token.
- Clears the refresh cookie.
- Returns: 204.
- Audit log: `user.logout`.

### `POST /api/v1/lgpd/delete`

- Authenticated.
- Creates an `lgpd_jobs` row with `job_type = 'delete'`, `status = 'cancellable'`, generated `cancellation_token`.
- Sends confirmation email with cancellation link valid 7 days.
- Returns: 200 with `job_id` and `cancellable_until`.
- Audit log: `lgpd.delete_requested`.

### `POST /api/v1/lgpd/delete/cancel`

- Public (no auth) — uses the cancellation token from the email.
- Updates `lgpd_jobs.status = 'cancelled'` if still in the 7-day window.
- Returns: 200 if cancelled, 410 Gone if window expired or already in_progress.
- Audit log: `lgpd.delete_cancelled`.

## Conventions specific to this service

### Argon2id parameters

```typescript
const ARGON2_PARAMS = {
  variant: 'id',
  memoryCost: 65536,    // 64 MiB
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
};
```

These are tuned for current hardware. Changing them requires:
1. An ADR justifying the change.
2. A re-hash-on-next-login migration: store both old and new hash params; when a user logs in, if their stored hash uses old params, re-hash and update.

### Pepper

A pepper from Secrets Manager (`auth/password-pepper`) is concatenated to the password before hashing:

```typescript
const peppered = password + pepper;
const hash = await argon2.hash(peppered, ARGON2_PARAMS);
```

Pepper rotation is a planned operation (not currently scheduled). Rotating means: store both old and new pepper for a window, accept logins with either, then phase out old via the same re-hash-on-next-login pattern.

### JWT claims

```typescript
type AccessTokenClaims = {
  sub: string;          // user.id
  email: string;
  role: 'broker' | 'owner' | 'admin';
  plan: 'free' | 'starter' | 'pro';
  agency_id: string | null;
  iat: number;
  exp: number;          // iat + 3600
  iss: 'propmatch-auth';
  aud: 'propmatch-api';
};
```

Refresh tokens carry only `sub` and a token ID for revocation lookup. Refresh tokens are stored hashed in `refresh_tokens` table; we do not store the raw token.

### Setting RLS session vars

Every authenticated request runs in a Prisma transaction with session vars set:

```typescript
return await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SET LOCAL app.current_user_id = ${userId}::uuid`;
  await tx.$executeRaw`SET LOCAL app.current_user_role = ${role}`;
  return handler(tx, req);
});
```

A Fastify decorator wraps this. Routes that need DB access use `req.tx` instead of importing the raw Prisma client. **Never use `prisma.user.findMany()` directly in a route handler — always go through `req.tx`.**

### Audit logging

Every security-sensitive action writes to `audit_log` via `AuditService.log(...)`. The service auto-populates `actor_user_id`, `created_at`, and the request's `request_id`. Handlers pass `action`, `target_type`, `target_id`, and `details`.

Failures to write to audit log are logged but do not fail the request. We accept the tradeoff: a successful action with a missing audit entry is recoverable; a failed user action because of audit infrastructure is not.

### Rate limiting

Rate limiters use Redis sliding windows. The keys are namespaced:

- `rl:signup:ip:<ip>` — 5/hour.
- `rl:login:email:<sha256(email)>` — 10/15min.
- `rl:refresh:token:<token_id>` — 60/hour.

Lockout state is a separate key: `lockout:email:<sha256(email)>` set with TTL 10 min after 10 failures.

The Redis key for login uses `sha256(email)` to avoid logging emails in Redis MONITOR output during incident response.

### Errors

Every error thrown by handlers is an `AppError` with a `code` field:

```typescript
export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    public userMessage: string,  // PT-BR
    message: string,             // EN, developer-facing
    public details?: unknown,
  ) {
    super(message);
  }
}
```

Specific subclasses (`InvalidCredentialsError`, `TokenExpiredError`, `RateLimitExceededError`) extend AppError with sensible defaults. The Fastify error handler formats responses per `docs/api-conventions.md`.

## Testing

### Unit tests live next to source

- `password.service.test.ts` next to `password.service.ts`.
- Tests cover: hash returns argon2id, verify accepts correct password, verify rejects wrong password, constant-time on miss.

### Integration tests live in `tests/integration/`

- One file per route group.
- Each test runs against a fresh transaction that rolls back at the end.
- Common setup: `tests/integration/setup.ts` configures a testcontainer Postgres and seeds a base user.

### Critical paths must hit ≥ 90% coverage

- `password.service.ts`
- `token.service.ts`
- `auth.routes.ts`
- `lgpd.routes.ts`
- All RLS middleware

CI fails if coverage drops on these.

### RLS isolation tests are mandatory

For every table this service writes to:

```typescript
test('cannot read another user briefings', async () => {
  const userA = await userFactory();
  const userB = await userFactory();
  await briefingFactory({ user_id: userA.id });
  
  const result = await runAs(userB, async (tx) => {
    return await tx.briefing.findMany();
  });
  
  expect(result).toHaveLength(0);
});
```

`runAs` is the test helper that sets `app.current_user_id` and `app.current_user_role` for the transaction.

## Things never to do without asking

- Change the argon2id parameters.
- Change the JWT signing algorithm or claims.
- Skip audit logging on a security-sensitive action.
- Remove the lockout mechanism.
- Allow signup without `lgpd_consent_at`.
- Soften rate limits.
- Add a "remember me" feature without designing the security model first.

## Common gotchas

- **Constant-time comparison.** `argon2.verify` is constant time. But your *surrounding* code can leak: don't `if (!user) return error; if (!await verify(user.hash)) return error;` — that takes longer when the user exists. The pattern is: always run a verify (against a dummy hash if user doesn't exist) and check both conditions at the end.
- **Refresh token rotation race.** If two refresh requests arrive simultaneously with the same token, only one should succeed. The DB transaction with row-level lock on `refresh_tokens` handles this; do not bypass.
- **Email casing.** Emails are lowercased on write and on lookup. Always.
- **Phone E.164.** Validate and store in E.164 (`+5511987654321`). Never store as `(11) 98765-4321`.
- **LGPD consent timestamp.** Captured at signup. Once set, does not change. Revoking consent terminates the account (deletion flow).
- **JWT `iss` and `aud` are checked.** A token from another service must be rejected. The `jose` verifier must be configured with these claims.

## Where to look when stuck

- HTTP and error conventions: `../../docs/api-conventions.md`
- Security baseline (argon2, JWT, RLS): `../../docs/security.md`
- LGPD specifics: `../../docs/lgpd-compliance.md`
- Manual deletion runbook: `../../docs/ops/lgpd-manual-deletion.md`
- Schema reference: `../../docs/data-model.md`
- ADRs: `../../docs/adr/`
