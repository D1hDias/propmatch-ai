# Dev Setup

How to bootstrap a working PropMatch AI development environment from scratch. If you follow this and something fails, the failure is a bug — please open a ticket.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20.x LTS | `fnm install 20 && fnm use 20` (recommended) |
| pnpm | 9.x | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker | latest | for local Postgres + Redis |
| Docker Compose | v2+ | bundled with Docker Desktop |
| Git | 2.30+ | |
| jq | any | nice for log inspection |

OS: macOS or Linux. Windows works through WSL2 only.

## Initial bootstrap

```bash
git clone git@github.com:propmatch/propmatch-ai.git
cd propmatch-ai

# Install dependencies
pnpm install

# Bring up local Postgres + Redis
docker compose -f infra/docker-compose.dev.yml up -d

# Run database migrations
pnpm prisma migrate dev

# Seed development data
pnpm db:seed

# Start the app
pnpm dev
```

After `pnpm dev` warms up:
- App: http://localhost:3000
- Postgres: localhost:5432 (user: `propmatch`, db: `propmatch_dev`, password: `dev`)
- Redis: localhost:6379

There is **one** process. There is **one** dev URL. This is intentional — much simpler than the previous multi-service plan.

## Environment variables

Copy the template:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored. Fill in real values for:

- `ANTHROPIC_API_KEY` — get one from the Anthropic console; ask in `#engineering` for a shared dev key (in 1Password under "PropMatch Dev — Anthropic")
- `RESEND_API_KEY` — only needed when working on email flows; `noop` works for everything else
- `STRIPE_SECRET_KEY` — only needed when working on billing

Everything else has working defaults pointing at the local Postgres/Redis.

For team-wide secret sync we use `dotenv-vault` (see ADR-0009). To pull the latest team secrets:

```bash
pnpm dotenv-vault pull development
```

## Common commands

```bash
# Run dev server
pnpm dev

# Lint and format
pnpm lint
pnpm format

# Typecheck
pnpm typecheck

# Run unit + integration tests
pnpm test

# Watch mode
pnpm test:watch

# Run E2E tests (Playwright)
pnpm e2e
pnpm e2e:headed   # see the browser
pnpm e2e:debug    # Playwright inspector

# Build for production
pnpm build

# Run production build locally (verify before deploy)
pnpm start

# Database migrations
pnpm prisma migrate dev --name <migration_name>   # create + apply in dev
pnpm prisma migrate deploy                         # apply pending (used in CI/prod)
pnpm prisma studio                                 # GUI to inspect DB

# Reset local database (destroys data, re-applies migrations, re-seeds)
pnpm db:reset
```

## Project structure (developer view)

```
src/
├── app/                       Next.js App Router
│   ├── (auth)/                Layout group: signup, login
│   ├── (app)/                 Layout group: dashboard, briefings, clients, settings
│   ├── api/v1/                REST API route handlers
│   │   ├── auth/
│   │   ├── briefings/
│   │   ├── search/
│   │   └── lgpd/
│   ├── layout.tsx             Root layout
│   ├── error.tsx              Error boundary
│   └── globals.css            Tailwind + design tokens
├── server/                    Server-only — never imported from client components
│   ├── auth/                  Auth domain (was auth-svc)
│   ├── briefings/             Briefing extraction + HITL
│   ├── search/                Source orchestration + dedup
│   ├── messaging/             WhatsApp formatter
│   ├── db/                    Prisma client + RLS transaction helper
│   └── lib/                   Errors, audit, secrets, outbound HTTP wrapper
├── components/
│   ├── ui/                    shadcn/ui primitives (copied, locally edited)
│   └── ...                    Domain components
├── hooks/                     Client-side hooks
├── lib/                       Shared (used by both server and client)
│   ├── schemas/               zod schemas — single source of truth for validation
│   ├── format/                Money, phone, date formatters
│   └── types/                 Shared type definitions
├── i18n/                      PT-BR strings
└── middleware.ts              Auth, rate limit, RLS context
```

## Working with the codebase

### Server vs client components

By default in App Router, components are **server components**. They render on the server, never hydrate, and can directly import server-only code.

Add `"use client"` at the top of a file when you need:
- React state (`useState`, `useReducer`)
- Effects (`useEffect`)
- Browser APIs (clipboard, EventSource, localStorage, etc.)
- Event handlers attached to JSX
- Third-party libraries that depend on browser APIs

Rule of thumb: keep client components small and leaf-level. Wrap an interactive piece in a small client component instead of converting an entire page.

### Importing server code

Server modules are tagged with `import 'server-only'` at the top. Importing them from a client component is a build error — by design. If you need a value from the server in a client component, fetch it via an API route or pass it as a prop from a server component.

### Database access

Always go through the RLS-aware transaction helper:

```typescript
import { withRlsContext } from '@/server/db/client';

await withRlsContext(req.userId, req.userRole, async (tx) => {
  return await tx.briefing.findMany();
});
```

Never `import { prisma }` directly in route handlers. The helper sets `app.current_user_id` and `app.current_user_role` session vars; bypassing it bypasses RLS.

### Adding a dependency

Don't add dependencies casually. Each one is a maintenance commitment.

```bash
pnpm add <package>
pnpm add -D <dev-package>
```

In your PR, justify the dependency: what does it do, why not write it ourselves, what's the alternative.

## Database conventions in dev

- Local DB name: `propmatch_dev`. Tests use `propmatch_test`.
- Seeds create: 1 admin, 1 agency owner, 3 brokers under that agency, ~50 sample properties, ~10 sample briefings.
- Default broker login: `broker1@propmatch.test` / `dev-password-123`.
- Don't run migrations against staging or production from your laptop. Use the deploy pipeline.

## Working with Docker Compose

```bash
docker compose -f infra/docker-compose.dev.yml up -d       # start
docker compose -f infra/docker-compose.dev.yml down        # stop
docker compose -f infra/docker-compose.dev.yml logs -f     # tail logs
docker compose -f infra/docker-compose.dev.yml down -v     # full reset; loses data
```

The compose file runs Postgres 16 + Redis 7. That's it.

## Editor setup

VSCode is the default; `.vscode/settings.json` and `.vscode/extensions.json` are committed.

Recommended extensions (auto-suggested on open):
- ESLint
- Prettier
- Tailwind CSS IntelliSense
- Prisma
- GitLens
- Error Lens

JetBrains IDEs work fine.

## When something doesn't work

1. **Read the error.** "ECONNREFUSED 5432" means Postgres isn't running. `docker compose -f infra/docker-compose.dev.yml up -d`.
2. **Check `.env.local` is present and has the required keys.**
3. **Check Node version** matches `.nvmrc` (`fnm use` reads it).
4. **Try `pnpm install` again.** It's idempotent.
5. **Try `pnpm db:reset`** if data is the problem.
6. **Try `docker compose down -v && docker compose up -d`** if infrastructure is wrong (loses local data).
7. **Ask in `#engineering`** with: what you ran, what error you got, what you've already tried.

## Onboarding gate

You're done with onboarding when:

- [ ] You can sign up via http://localhost:3000, log out, log back in.
- [ ] You can run `pnpm test` and all suites pass.
- [ ] You can run `pnpm e2e` and the smoke test passes.
- [ ] You've made one trivial commit (typo fix in a doc) and successfully opened a PR through the standard flow.

Total time: ~30 minutes if everything works.

## Connecting to the production VPS (read-only, for debugging)

For approved engineers only:

```bash
# SSH access via the bastion entry in 1Password
ssh propmatch-prod    # alias defined in your ~/.ssh/config

# Read-only DB access
psql -h localhost -U readonly -d propmatch
```

Never run migrations or arbitrary writes from a personal SSH session. All changes go through the deploy pipeline.
