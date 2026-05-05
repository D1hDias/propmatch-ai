# Architecture

This document is the engineering reference for PropMatch AI's architecture. It is derived from PRD §5 and ADRs but is the operational source of truth for engineers and Claude Code. Updates to architecture happen here first, in the PRD second.

## System overview

PropMatch AI is a service-oriented application optimized for one thing: turning a free-form briefing into a WhatsApp-ready message in under 10 seconds.

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENT (Web App)                         │
│        React 18 + TypeScript + Tailwind + shadcn/ui              │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTPS / WSS
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                       API GATEWAY (Kong)                         │
│   Auth · Per-broker concurrency cap · Rate Limit · Routing       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
       ┌─────────────────┼─────────────────┬──────────────────┐
       ▼                 ▼                 ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  AUTH SVC   │  │ BRIEFING SVC │  │  SEARCH SVC  │  │ MESSAGING SVC│
│  (Node)     │  │  (Python)    │  │  (Python)    │  │  (Node)      │
│  JWT/OAuth  │  │  NLP+HITL    │  │  Aggregate   │  │  Clipboard / │
│             │  │              │  │  + dedup     │  │  WA Cloud    │
└─────────────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                        │                 │                 │
                        ▼                 ▼                 ▼
                  ┌─────────────────────────────────────────────┐
                  │         CORE DATA LAYER                     │
                  │  PostgreSQL 16 · Redis 7 · S3 · OpenSearch  │
                  └─────────────────────────────────────────────┘
                        ▲                 ▲
                        │                 │
              ┌─────────┴───────┐  ┌──────┴───────┐
              │ SCRAPER FLEET   │  │ PARTNER APIs │
              │ (Playwright)    │  │ (preferred)  │
              └─────────────────┘  └──────────────┘
```

## Services

### auth-svc (Node)

Owns: signup, login, refresh, logout, OAuth, LGPD consent capture, LGPD deletion endpoint.

Stateless. Reads/writes `users`, `agencies`, `lgpd_jobs`, `audit_log`. Issues JWTs (1h access, 30d refresh). Rate limits enforced at the gateway *and* at the service for defense in depth.

### briefing-svc (Python)

Owns: free-form briefing intake, LLM extraction, criteria schema validation, HITL review queue.

Calls the Anthropic Claude API. Routes briefings with confidence below 0.85 or missing critical fields to the HITL queue (BullMQ, p95 SLA 3 min). Implements the 3-tier overflow logic from PRD §5.6.

### search-svc (Python)

Owns: source orchestration, deduplication, ranking, auto-widen logic.

Calls the SourceAdapter implementations (one per source, including Source 2 and Source 3 contingency — see ADR-0006). Deduplicates by address normalization + geohash-7 (image pHash deferred to Phase 2). Ranks by fit score. Caps raw results at 200 per briefing pre-dedup. Streams results to the client via WebSocket.

### messaging-svc (Node)

Owns: WhatsApp message formatting, clipboard delivery, WhatsApp Cloud API integration (Phase 2).

Takes selected property IDs and returns formatted text with shortened links. Phase 2: integrates with Meta's WhatsApp Cloud API for direct send.

## Data layer

### PostgreSQL 16

Primary store. ACID. Row-level security (RLS) on every user-scoped table. Schema documented in `docs/data-model.md`. Migrations via Prisma (ADR-0001).

Indexes follow query patterns; no speculative indexes. Use `TIMESTAMPTZ` always. Money is `NUMERIC(12,2)`.

### Redis 7

Cache only. TTL 15 minutes for hot listings, eviction policy LFU. Never the source of truth — if Redis is down, services degrade gracefully by hitting Postgres directly.

Used for: rate-limit counters (sliding window), HITL queue state (BullMQ), session refresh-token blocklist.

### OpenSearch

Full-text + geospatial search over the canonical `properties` table. Indexed asynchronously after a property is upserted. Sharded by region at GA scale (PRD §5.4).

### S3 (or Cloudflare R2 for MVP)

Property images, partner spreadsheets (Phase 2), DSAR export bundles. Lifecycle policies enforce retention windows from `docs/lgpd-compliance.md`.

## Data flow: briefing to clipboard

End-to-end target: 6–10 seconds.

1. **t=0** — Broker submits briefing. Gateway checks per-broker concurrency cap (3 for Starter, 10 for Pro).
2. **t=0.1s** — briefing-svc validates request, calls Claude API, runs schema validation on the response.
3. **t=0.3s** — Confidence routing:
   - ≥ 0.85 + complete: proceed.
   - 0.80–0.85 + complete: auto-approve with override flag.
   - < 0.80 OR missing critical field: HITL queue (3 min p95 SLA).
   - HITL overflow (queue p95 > 10 min): surface to broker for direct edit.
4. **t=1.5s** — search-svc fans out parallel queries: OpenSearch cache, partner APIs, scraper queue (fallback).
5. **t=4s** — Results return; dedup runs (geohash + address); ranking applied; result count check (auto-widen if < 5).
6. **t=5s** — Ranked results streamed to client via WebSocket.
7. **t=variable** — Broker curates and clicks "Generate WhatsApp."
8. **t+1s** — messaging-svc formats message, generates short links, returns formatted text for clipboard.

## Cross-cutting concerns

### Authentication and authorization

JWT with refresh. RLS enforces tenant isolation at the database layer. See `docs/security.md` and ADR-0005.

### Concurrency and throttling

Per-broker concurrency cap at the gateway. Spike throttling: if search-svc p95 latency exceeds 8s for >2 min, gateway temporarily reduces concurrency to 1/broker; auto-recovers when p95 returns below 6s for 5 consecutive minutes.

### Source health

Each SourceAdapter implements `health_check()`. Background monitor polls every 60s. If a source fails > 20% of requests over 24h, it auto-disables and triggers an ops alert. Source 3 is a feature-flag swap for Source 2 — see `docs/ops/runbook-source-failover.md` and ADR-0006.

### HITL queue

BullMQ-backed. Queue depth alarm at 50 pending items. Auto-prioritization: Pro-tier briefings jump the queue, aging > 2 min gets priority, single-missing-field cases fast-path.

### Observability

- **APM:** Datadog auto-instrumentation across services. Service map and trace timing visible in dashboard.
- **Errors:** Sentry capturing unhandled exceptions; PR check fails if Sentry DSN is missing for a new service.
- **Logs:** Structured JSON. `request_id` propagates across service boundaries.
- **Metrics:** Custom metrics for HITL queue depth, source success rate, briefing-to-clipboard time. Dashboard reviewed weekly.

### Secrets management

AWS Secrets Manager (production) or Railway secrets (staging/dev). Never `.env` files. See ADR-0004.

## Scaling plan

| Phase | Timeline | Concurrent users | Properties indexed | Briefings/day | Concurrent searches/broker |
|-------|----------|------------------|---------------------|----------------|----------------------------|
| MVP launch | Week 10 | 100 | 5,000 | 500 | 3 |
| Beta | Month 4 | 500 | 50,000 | 3,000 | 5 |
| GA | Month 8 | 2,000 | 500,000 | 15,000 | 8 |
| Year-1 | Month 12 | 5,000 | 5,000,000 | 50,000 | 10 (Pro) / 5 (Starter) |

Each phase triggers a re-architecture review. The MVP-to-Beta transition migrates from Railway to AWS ECS Fargate. Beta-to-GA introduces OpenSearch sharding by region. GA-to-Year-1 adds read replicas and a CDN media tier.

## Architectural callouts

These are the things that constrain implementation choices and should be visible to anyone modifying the system:

- API Gateway enforces per-broker concurrency cap. Excess requests queue with a 30s timeout.
- Spike throttling kicks in when p95 search latency > 8s for 2 min.
- HITL queue maintained at ≤ 200 pending items; over threshold triggers overflow rules.
- Search service caps raw results at 200 per briefing pre-dedup.
- Dedup compute has a 50ms p95 budget per briefing; exceeded items downgrade to address-only matching.
- OpenSearch sharding capped at 5 shards per region until GA forces re-architecture review.

## What this architecture optimizes for

- **Briefing-to-clipboard latency.** Every component is on the hot path; nothing should add measurable time without a clear reason.
- **Source pluggability.** SourceAdapter interface lets us swap, add, or disable sources without code changes — only feature flags. This makes the Source 2 → Source 3 contingency real, not aspirational.
- **LGPD-by-default.** Retention, deletion, and consent are enforced by the data layer (constraints, cron jobs, RLS), not by application code that might forget.
- **Broker trust.** Failures degrade gracefully (partial results with clear messaging) rather than blocking the workflow.

## What this architecture explicitly does not optimize for

- **Buyer-side use cases.** This is a broker tool. We do not build features for end consumers.
- **Polyglot persistence.** PostgreSQL is the source of truth. OpenSearch is a derived index. Redis is a cache. We will not introduce a NoSQL primary store unless data volume forces it (PRD §5.4 indicates this is unlikely before Year 2).
- **Multi-region writes.** All writes go to a single Postgres primary in São Paulo region until LATAM expansion forces otherwise.
