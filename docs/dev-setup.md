# Dev Setup

How to bootstrap a working PropMatch AI development environment from scratch. If you follow this and something fails, the failure is a bug — please open a ticket.

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20.x LTS | `fnm` recommended; `nvm` works |
| pnpm | 9.x | `corepack enable && corepack prepare pnpm@latest --activate` |
| Python | 3.12 | `pyenv` recommended |
| uv | latest | `pip install uv` or `brew install uv` |
| Docker | latest | for local Postgres, Redis, OpenSearch |
| Docker Compose | v2+ | usually bundled with Docker Desktop |
| Git | 2.30+ | |
| Make | any | usually pre-installed |

Optional but recommended:
- `direnv` for per-directory env loading
- `mkcert` for local HTTPS

Operating system: macOS or Linux. Windows works through WSL2 only.

## Initial bootstrap

```bash
git clone git@github.com:propmatch/propmatch-ai.git
cd propmatch-ai

# Install all workspace dependencies
pnpm install

# Bootstrap services and shared packages
pnpm bootstrap

# Bring up local infrastructure
make infra-up

# Run database migrations
pnpm migrate

# Seed development data
pnpm seed

# Start everything in dev mode
pnpm dev
```

After `pnpm dev` finishes warming up:
- Web app: http://localhost:5173
- Auth service: http://localhost:3001
- Briefing service: http://localhost:8001
- Search service: http://localhost:8002
- Messaging service: http://localhost:3002
- Postgres: localhost:5432
- Redis: localhost:6379
- OpenSearch: http://localhost:9200

## Environment variables

Local dev uses `.env.local` files in each service. They're git-ignored. Templates exist as `.env.example`. After `pnpm bootstrap`, the templates are copied to `.env.local` automatically; you only need to fill in real values for:

- `ANTHROPIC_API_KEY` — get one from the Anthropic console; ask in `#engineering` for a shared dev key.
- `STRIPE_SECRET_KEY` — Stripe test mode key; only needed when working on billing.

Everything else has working defaults pointing at the local infrastructure.

## Common commands

```bash
# Run a single service
pnpm --filter auth-svc dev

# Run unit tests
pnpm test

# Run unit tests for a single package
pnpm --filter auth-svc test

# Run E2E tests
pnpm e2e

# Lint and format
pnpm lint
pnpm format

# Typecheck
pnpm typecheck

# Build everything for production
pnpm build

# Database migrations
pnpm migrate            # apply pending migrations
pnpm migrate:rollback   # roll back the last migration
pnpm migrate:create -- <name>  # create a new migration

# Reset local database to a clean state
pnpm db:reset
```

## Working with services

Each service has its own `package.json` (Node) or `pyproject.toml` (Python) with service-specific scripts. The most common ones are:

```bash
# In any Node service directory
pnpm dev          # watch mode
pnpm test         # vitest
pnpm test:watch   # vitest watch mode
pnpm lint
pnpm typecheck

# In any Python service directory
uv run dev        # uvicorn with reload
uv run test       # pytest
uv run lint       # ruff check
uv run format     # ruff format
uv run typecheck  # mypy
```

## Adding a dependency

**Do not add dependencies casually.** Each new dependency is a maintenance commitment.

```bash
# Node
pnpm --filter auth-svc add <package>
pnpm --filter auth-svc add -D <dev-package>

# Python
cd services/briefing-svc
uv add <package>
uv add --dev <dev-package>
```

In your PR, justify the dependency: what does it do, why not write it ourselves, what's the alternative? Reviewers will push back on dependencies that don't earn their weight.

## Database conventions in dev

- The local database is named `propmatch_dev`. Tests use `propmatch_test`.
- Seeds create: 1 admin, 1 agency owner, 3 brokers under that agency.
- Default broker login: `broker1@propmatch.test` / `dev-password-123`.
- Don't run migrations against staging or production from your laptop. Use the deploy pipeline.

## Working with Docker Compose

```bash
make infra-up         # start postgres, redis, opensearch
make infra-down       # stop them
make infra-logs       # tail logs
make infra-reset      # full reset; loses data
```

The compose file is in `infra/docker-compose.dev.yml`.

## Branch and commit

```bash
git checkout -b feat/AUTH-2-jwt-signup-login
# ... do work ...
git add -p
git commit -m "feat(auth): add refresh token rotation"
git push -u origin feat/AUTH-2-jwt-signup-login
```

Open a PR against `main`. CI runs lint, typecheck, unit tests, integration tests on each push. A PR cannot be merged with failing CI.

## Editor setup

VSCode is the default; `.vscode/settings.json` and `.vscode/extensions.json` are committed.

Recommended extensions (auto-suggested on open):
- ESLint
- Prettier
- Python
- Pylance
- Tailwind CSS IntelliSense
- Prisma
- GitLens

JetBrains IDEs work fine; settings are not committed but the standard inspections cover the same ground.

## When something doesn't work

1. **Read the error.** "ECONNREFUSED 5432" means Postgres isn't running. `make infra-up`.
2. **Check `.env.local` is present and filled in.**
3. **Check Node and Python versions** match `.nvmrc` and `.python-version`.
4. **Try `pnpm bootstrap` again** — it's idempotent.
5. **Try `pnpm db:reset`** if data is the problem.
6. **Try `make infra-reset`** if infrastructure is the problem (loses local data).
7. **Ask in `#engineering` Slack** with: what you ran, what error you got, what you've already tried.

## Getting an Anthropic API key for dev

There's a shared dev API key in 1Password under "PropMatch Dev — Anthropic". Ask any engineer for the share. Do not commit the key. Do not use it for high-volume testing — it counts against the team budget.

For load tests against Claude, use a per-engineer key from your own Anthropic console; expense it.

## Debugging tips

- Backend services log structured JSON. Pipe through `jq` to read: `pnpm --filter auth-svc dev | jq`.
- Frontend errors surface in the browser console; Sentry replays available locally only when `SENTRY_DEV_MODE=true`.
- Postgres queries can be traced by setting `DEBUG_SQL=true` in `.env.local`. Verbose; turn off when not needed.
- API requests can be traced via the `X-Request-Id` header — same ID propagates across services.

## Onboarding gate

You're done with onboarding when:

- [ ] You can sign up via the web app at http://localhost:5173, log out, log back in.
- [ ] You can run `pnpm test` from the repo root and all suites pass.
- [ ] You can run `pnpm e2e` and the smoke test passes.
- [ ] You've made one trivial commit (e.g., a typo fix in a doc) and successfully opened a PR through the standard flow.

Total time: ~30 minutes if everything works.
