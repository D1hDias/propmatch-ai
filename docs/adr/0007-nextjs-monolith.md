# ADR-0007: Next.js 15 Monolith on Hostinger VPS

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Tech Lead
**Supersedes:** ADR-0002 (TanStack Router)

## Context

PropMatch AI's MVP will be hosted on a Hostinger VPS KVM 2 (2 vCPU, 8 GB RAM). The original architecture (4 Node/Python microservices + Vite SPA + Railway deploy) does not fit this hardware: OpenSearch alone needs 2-4 GB; running 4 separate runtimes plus Postgres plus Redis exhausts the box before the first broker logs in.

The MVP load (100 concurrent users, 500 briefings/day) doesn't actually require a microservice architecture. Logical separation matters; physical separation does not.

This decision needs to be made before Sprint 1 implementation begins, because it changes everything downstream: build, deploy, framework, project layout.

## Alternatives considered

### Alternative A: Next.js 15 (App Router) monolith
- Pro: Single codebase, single deploy, single process. Fits the VPS comfortably.
- Pro: App Router is mature; server components reduce client bundle weight.
- Pro: API routes (`route.ts`) replace separate backend services; no IPC, no extra processes.
- Pro: Server-Sent Events for streaming results work natively (no separate WebSocket server).
- Pro: Vercel-influenced DX (great error pages, fast HMR).
- Con: Tied to React in App Router's specific way. Can't trivially swap to a different frontend.
- Con: Server components have a learning curve; "use client" boundaries can confuse.

### Alternative B: React (Vite SPA) + separate Fastify/Hono backend
- Pro: Cleaner separation between frontend and backend.
- Pro: Backend framework choice is independent.
- Con: Two processes on the VPS, two deploys, two sets of routing/middleware.
- Con: WebSocket / SSE setup is more work (need a separate server or a streaming endpoint).
- Con: We give up SSR for content that benefits from it (initial dashboard load).

### Alternative C: Remix (also React-based, full-stack)
- Pro: Excellent SSR story; nested routes; data loading patterns are clean.
- Con: Smaller ecosystem than Next.js.
- Con: Less leverage from the team's existing Next.js familiarity.

### Alternative D: SvelteKit
- Pro: Smallest bundle, fastest dev experience.
- Con: Smaller ecosystem; we'd be alone debugging tricky issues.
- Con: No team experience; ramp-up cost.

## Decision

**Next.js 15 with App Router**, deployed as a single process on the VPS via systemd.

## Rationale

The VPS constraint forces consolidation. Next.js gives us frontend + API routes + SSR + streaming in one codebase. The "server vs client component" model maps cleanly onto our actual needs: most pages are server-rendered with small interactive islands.

Every alternative either splits us across more processes (which strains VPS RAM) or has worse ecosystem leverage (Remix, SvelteKit). The "react-only" lock-in is acceptable — we're not betting against React in the next 3 years.

This supersedes ADR-0002 (TanStack Router): App Router replaces TanStack Router. Both are file-based routers with type-safe params; the migration cost from one to the other is low if we ever need to swap.

## Consequences

### Positive
- Fits a single VPS comfortably with headroom.
- Single deploy artifact; one `pnpm build` produces both the SSR app and the API.
- SSR for pages that benefit from it (dashboard, briefing detail).
- SSE for streaming search results works without extra infrastructure.
- Type safety from DB → server → client via shared zod schemas.
- Smaller team can move faster — no IPC contracts to maintain.

### Negative
- All eggs in one basket: a deploy regression takes everything down. Mitigations: blue-green via two systemd units, deploy windows, rollback playbook.
- Scaling horizontally requires moving off VPS to a managed platform (planned for GA, not earlier).
- Mixed server/client component model has a learning curve. Mitigation: per-domain CLAUDE.md when domains grow complex.

### Neutral
- The original "4 services" naming survives as `src/server/auth`, `src/server/briefings`, etc. Logical separation preserved; physical separation deferred.
- Source 2 scrapers (Playwright) live on a separate cheap VPS. The main VPS does not run scrapers — too memory-hungry.

## Project layout

```
src/
├── app/                       # Next.js App Router
│   ├── (auth)/                # Route group: signup, login
│   ├── (app)/                 # Route group: authenticated UI
│   ├── api/v1/                # REST API route handlers
│   ├── layout.tsx
│   └── globals.css
├── server/                    # Server-only modules (was 4 services)
│   ├── auth/
│   ├── briefings/
│   ├── search/
│   └── messaging/
├── components/
├── hooks/
├── lib/
└── middleware.ts              # auth, rate limit, RLS context
```

## When to revisit

- If the VPS load ratio (RAM, CPU, p95 latency) exceeds 70% sustained for >2 weeks at MVP scale, evaluate moving to a larger VPS or managed hosting.
- If we hire >5 backend engineers and parallel work on different domains causes coordination overhead, consider extracting one or two domains as separate services.
- If Next.js's App Router introduces a breaking change we can't migrate cheaply, evaluate Remix or going back to Vite SPA + separate API.
- At the GA scaling phase (Year 1), this decision is automatically up for review per the architecture plan.

## References

- `docs/architecture.md`
- `docs/dev-setup.md`
- ADR-0002 (superseded)
- https://nextjs.org/docs/app
