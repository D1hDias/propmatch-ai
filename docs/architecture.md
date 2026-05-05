# Architecture

This document is the engineering reference for PropMatch AI's architecture. It is derived from PRD §5 + ADRs but is the operational source of truth.

## System overview

PropMatch AI is a **single Next.js 15 application** deployed on a Hostinger VPS, fronted by Cloudflare. The architecture optimizes for one thing: turning a free-form briefing into a WhatsApp-ready message in under 10 seconds, on hardware that costs ~$10/month.

```
                        ┌──────────────────────────────────┐
                        │          BROKER BROWSER          │
                        └────────────────┬─────────────────┘
                                         │ HTTPS
                                         ▼
                        ┌──────────────────────────────────┐
                        │   CLOUDFLARE (DNS + WAF + Cache) │
                        └────────────────┬─────────────────┘
                                         │
                                         ▼
                        ┌──────────────────────────────────┐
                        │        HOSTINGER VPS (KVM 2)     │
                        │   ┌────────────────────────────┐ │
                        │   │   Caddy (reverse proxy)    │ │
                        │   │   TLS via Let's Encrypt    │ │
                        │   └─────────────┬──────────────┘ │
                        │                 │                │
                        │   ┌─────────────▼──────────────┐ │
                        │   │  Next.js 15 App (PM2/      │ │
                        │   │  systemd-managed)          │ │
                        │   │  ┌────────────────────────┐│ │
                        │   │  │  src/app/  (UI + SSR) ││ │
                        │   │  │  src/app/api/  (REST) ││ │
                        │   │  │  src/server/  (logic) ││ │
                        │   │  └────────────────────────┘│ │
                        │   └─┬───────────┬───────────┬──┘ │
                        │     │           │           │    │
                        │     ▼           ▼           ▼    │
                        │  ┌──────┐   ┌──────┐   ┌──────┐  │
                        │  │ PG16 │   │Redis7│   │BullMQ│  │
                        │  └──────┘   └──────┘   └──────┘  │
                        └────────┬─────────────────────┬───┘
                                 │                     │
            ┌────────────────────┼────────────┬────────┘
            ▼                    ▼            ▼
      ┌──────────┐         ┌──────────┐  ┌──────────────┐
      │Anthropic │         │  Cloud   │  │ Resend       │
      │  Claude  │         │ flare R2 │  │ (email)      │
      └──────────┘         └──────────┘  └──────────────┘
                                              │
                                              ▼
                                  ┌────────────────────────┐
                                  │   SCRAPER FLEET        │
                                  │   (separate VPS)       │
                                  │   Playwright + proxy   │
                                  │   (only when Source 2  │
                                  │    is live)            │
                                  └────────────────────────┘
```

## What runs where

### On the main VPS
- Caddy (reverse proxy + TLS)
- Next.js app (single Node.js process)
- PostgreSQL 16
- Redis 7

Total RAM budget at MVP load: ~5 GB. Headroom: ~3 GB for spikes and growth.

### External (does not tax the VPS)
- Anthropic Claude API (briefing extraction)
- Cloudflare R2 (property images, exports)
- Cloudflare edge (DNS, cache, WAF, DDoS mitigation)
- Resend (transactional email)
- Sentry (error tracking)
- BetterStack (uptime + log aggregation)

### Deferred / separate
- **Scraper fleet** — when Source 2 (scraped portal) goes live, scrapers run on a separate cheap VPS (Hetzner CX22 ~$5/mo or similar). They write into the main DB via authenticated API. Playwright is too memory-hungry to share the main VPS.
- **OpenSearch** — only when Postgres FTS stops being enough (estimated >100k indexed properties; we revisit at Beta).
- **pHash worker** — Phase 2 image dedup; runs on the same scraper VPS.

## Logical modules (in `src/server/`)

The four "services" from the original PRD become four directories in the monolith. Same separation, no IPC.

### `src/server/auth/`

Owns: signup, login, refresh, logout, OAuth (Sprint 2), LGPD consent capture, LGPD deletion endpoint.

Stateless. Reads/writes `users`, `agencies`, `lgpd_jobs`, `audit_log`. Issues JWTs (1h access, 30d refresh). Rate limits enforced in middleware.

### `src/server/briefings/`

Owns: free-form briefing intake, LLM extraction, criteria schema validation, HITL review queue.

Calls Anthropic via the outbound HTTP wrapper. Routes briefings with confidence < 0.85 or missing critical fields to BullMQ (HITL queue). Implements 3-tier overflow logic from PRD §5.6.

### `src/server/search/`

Owns: source orchestration, deduplication, ranking, auto-widen.

Calls SourceAdapter implementations (one per source — see ADR-0006). Deduplicates by address normalization + geohash-7 (image pHash deferred to Phase 2). Streams results to clients via Server-Sent Events (SSE).

### `src/server/messaging/`

Owns: WhatsApp message formatting, clipboard delivery, WhatsApp Cloud API (Phase 2).

Takes selected property IDs and returns formatted text with shortened links. Phase 2: integrates with Meta's WhatsApp Cloud API for direct send (Pro tier).

## Data layer

### PostgreSQL 16

Primary store. ACID. Row-level security (RLS) on every user-scoped table. Schema in `prisma/schema.prisma` and documented in `docs/data-model.md`. Migrations via Prisma (ADR-0001).

Self-hosted on the VPS. Tuning baseline (will need adjustment as load grows):
- `shared_buffers = 2GB`
- `effective_cache_size = 6GB`
- `work_mem = 16MB`
- `maintenance_work_mem = 256MB`
- `max_connections = 100` (Next.js connection pool 20, headroom for migrations and ad-hoc psql)
- WAL archiving enabled; daily base backup to R2 with `pgBackRest`.

### Redis 7

Self-hosted on the VPS. Cache + queue + rate limit counters. Eviction policy `allkeys-lfu`. Maxmemory ~512 MB.

Used for:
- TanStack Query cache invalidation hints
- BullMQ (HITL queue, scraper jobs)
- Sliding-window rate limiters
- Session refresh-token blocklist

Never the source of truth.

### Postgres FTS (instead of OpenSearch for MVP)

Full-text search via `tsvector` + GIN index on the `properties.search_vector` generated column. Trigram index via `pg_trgm` for fuzzy address matching during dedup. Adequate up to ~100k properties; revisit at Beta.

```sql
ALTER TABLE properties ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', coalesce(neighborhood, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(city, '')), 'B') ||
    setweight(to_tsvector('portuguese', coalesce(description, '')), 'C')
  ) STORED;

CREATE INDEX idx_properties_search ON properties USING GIN (search_vector);
CREATE INDEX idx_properties_address_trgm ON properties USING GIN (address_normalized gin_trgm_ops);
```

### Cloudflare R2

S3-compatible. Property images, DSAR export bundles, daily Postgres backups. Lifecycle policies enforce retention windows from `docs/lgpd-compliance.md`.

R2 has zero egress fees, which matters because property images served back to brokers' browsers go through Cloudflare's edge.

## Request lifecycle: briefing to clipboard

End-to-end target: 6–10 seconds.

1. **t=0** — Broker submits briefing. Cloudflare passes through to Caddy → Next.js.
2. **t=0.05s** — Middleware authenticates, sets RLS session vars on the request transaction, checks per-broker concurrency cap.
3. **t=0.1s** — Route handler `POST /api/v1/briefings` validates with zod, persists, calls `briefings.extract()`.
4. **t=0.4s** — Anthropic Claude API returns extracted criteria (typical 200-400ms).
5. **t=0.5s** — Confidence routing: ≥0.85 → proceed; 0.80–0.85 → auto-approve with override flag; <0.80 → HITL queue (3 min p95).
6. **t=0.6s** — Search-svc fans out parallel queries to active sources via `Promise.allSettled`.
7. **t=4s** — Results return. Dedup runs (50ms p95 budget). Ranking applied. Auto-widen if <5 results.
8. **t=4.5s** — Results streamed to client via SSE; `EventSource` on the browser receives `result_chunk`, `dedup_complete`, `search_complete`.
9. **t=variable** — Broker curates and clicks "Generate WhatsApp."
10. **t+1s** — `messaging.format()` returns formatted text; client copies to clipboard via `navigator.clipboard.writeText()`.

## Cross-cutting concerns

### Authentication & authorization

JWT (HS256, 1h access, 30d refresh). httpOnly cookies for refresh tokens. Middleware verifies on every authenticated route. RLS at the DB layer enforces tenant isolation. See `docs/security.md` and ADR-0005.

### Concurrency and throttling

Per-broker concurrency cap enforced in `src/middleware.ts` via Redis counters. Spike throttling: if search-svc p95 > 8s for 2 min, the cap is temporarily reduced; auto-recovers when p95 < 6s for 5 min.

### Source health

Each SourceAdapter implements `healthCheck()`. Background monitor (BullMQ scheduled job) polls every 60s. Source health drop > 20% over 24h auto-disables the source and triggers an alert. Source 2 → Source 3 swap is a feature-flag flip; see `docs/ops/runbook-source-failover.md` and ADR-0006.

### HITL queue

BullMQ-backed (Redis). Queue depth alarm at 50 pending items. Auto-prioritization: Pro-tier briefings jump the queue; aging > 2 min gets priority; single-missing-field cases fast-path.

### Streaming results

Server-Sent Events. Route handler is `GET /api/v1/briefings/{id}/stream`, returns `Content-Type: text/event-stream`. Client uses `EventSource`. Reconnection with exponential backoff is automatic on EventSource side; server tracks last-event-id to avoid replaying chunks.

SSE chosen over WebSocket because:
- Native to Next.js streaming responses; no separate WS server.
- Unidirectional (server → client) is all we need.
- Survives Cloudflare proxying without special config.
- Lower memory per connection.

### Observability

- **Errors:** Sentry. Source maps uploaded on build.
- **Logs:** structured JSON to stdout; systemd captures; BetterStack tails. PII never logged.
- **Uptime:** BetterStack 1-minute checks on `/healthz` and `/readyz`.
- **Metrics:** custom counters (briefing-to-clipboard time, HITL queue depth, source success rate) emitted as structured logs and aggregated in BetterStack.
- See ADR-0008.

### Secrets

Local dev: `.env.local` (gitignored), synced via `dotenv-vault`.
VPS: `EnvironmentFile=/etc/propmatch/secrets.env` mounted into the systemd unit, file mode 0600 owned by the propmatch user.
Rotation: documented per-secret in `docs/ops/secrets-rotation.md` (TBD).
See ADR-0009.

## Deployment

### Build and deploy

GitHub Actions on `main` push:
1. Lint, typecheck, unit tests, integration tests against ephemeral Postgres.
2. Build Next.js (`pnpm build`).
3. SSH to VPS as the deploy user.
4. Pull latest, install deps, run migrations, build, reload service.

```
# infra/deploy/deploy.sh
cd /opt/propmatch
git pull
pnpm install --frozen-lockfile
pnpm prisma migrate deploy
pnpm build
sudo systemctl reload propmatch.service
```

`systemctl reload` triggers a graceful restart via PM2-style hot reload OR a brief 1-2s downtime depending on the strategy. For zero-downtime, we run two Next.js processes behind Caddy with a load-balancer config — but only when uptime SLA demands it (post-Beta).

### Migrations

Migrations run automatically on deploy. They are reversible. Risky migrations (column drops, type changes on big tables) get the manual two-deploy treatment: deploy the code that handles both states, then deploy the migration, then deploy the code that handles only the new state.

## Scaling plan

| Phase | Timeline | Concurrent users | Properties indexed | Briefings/day | Hosting |
|-------|----------|------------------|---------------------|----------------|---------|
| MVP launch | Week 10 | 100 | 5,000 | 500 | Hostinger VPS KVM 2 |
| Beta | Month 4 | 500 | 50,000 | 3,000 | Hostinger VPS KVM 4 (4 vCPU, 16 GB) or move to managed |
| GA | Month 8 | 2,000 | 500,000 | 15,000 | Move to managed: Neon (Postgres) + Render or Fly.io for app + R2 stays |
| Year-1 | Month 12 | 5,000 | 5,000,000 | 50,000 | Multi-region; possibly back to AWS Fargate (revisit) |

Each phase triggers a re-architecture review. The MVP-to-Beta transition is bounded: same code, bigger VPS or move to managed Postgres. The Beta-to-GA transition introduces OpenSearch (or Postgres + Typesense) and a CDN media tier.

## What this architecture optimizes for

- **Briefing-to-clipboard latency.** Every component is on the hot path; nothing adds measurable time without a clear reason.
- **VPS-friendly memory and CPU footprint.** All deferred concerns (OpenSearch, scrapers, pHash) are explicitly off-box.
- **Source pluggability.** SourceAdapter lets us swap, add, or disable sources via feature flag without code changes.
- **LGPD-by-default.** Retention, deletion, and consent are enforced by the data layer (constraints, cron jobs, RLS), not by app code that might forget.
- **Broker trust.** Failures degrade gracefully (partial results with PT-BR messaging) rather than blocking workflow.

## What this architecture explicitly does not optimize for

- **Multi-region.** All state in one VPS in São Paulo region until LATAM expansion forces otherwise.
- **Buyer-side use cases.** Broker tool only.
- **Polyglot persistence.** Postgres is the source of truth. Redis is cache + queue. R2 is object storage. No NoSQL primary store.
- **Zero-downtime deploys.** A 1-2s blip during reload is acceptable until uptime SLA demands otherwise.
- **Horizontal scale on day 1.** A single VPS can handle MVP load. Horizontal scaling is a Beta+ concern.
