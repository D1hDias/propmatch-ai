# PropMatch AI — Sprint 1 Ticket Pack

**Sprint:** S1 (Phase 0 — Foundations)
**Duration:** 2 weeks (Wk 1–2)
**Budget:** 38 story points (actual: 39)
**PRD reference:** v1.4 §9.2 (S1 row)
**Goal:** Land all foundational scaffolding so S2 can start building the briefing pipeline on a stable base. No user-visible features ship in S1; this sprint is pure plumbing.

---

## Sprint 1 Capacity Plan

| Engineer | Role | Capacity (pts) | Tickets |
|----------|------|----------------|---------|
| Tech Lead | Backend Python | 6 | AUTH-1, AUTH-3 |
| Backend Engineer | Node | 8 | AUTH-2, AUTH-4 |
| Frontend Engineer | React | 10 | FE-1, FE-2 |
| DevOps / SRE (0.5) | Infra | 11 | INFRA-1, INFRA-2, INFRA-3 |
| Designer (0.5) | UX/UI | — | Design tokens for FE-1, supports FE-2 |
| QA (0.5) | Test | 3 | QA-1 |
| Scraping Engineer | Python | reserved | Pre-work for S3 (source contract drafts, partner negotiation) — not S1 tickets |
| **Total** | | **38** | |

Scraping Engineer is intentionally off the S1 critical path; uses S1 capacity to advance Source 1 partner agreement and Source 3 LOI (per PRD §3.4 timeline closing Wk5/Wk8).

---

## Ticket: INFRA-1 — Monorepo and Workspace Setup

**Type:** Task · **Priority:** P0 · **Estimate:** 3 pts · **Owner:** DevOps
**Depends on:** —
**Blocks:** All other tickets

### Description
Set up the PropMatch AI monorepo with workspace tooling so backend services and frontend can share linting, formatting, and types. Use pnpm workspaces (Node) + Poetry/uv (Python) per service. Establish branch protection and code-owner rules on `main`.

### Acceptance Criteria
- AC1: `git clone` + single bootstrap command (`pnpm install && pnpm bootstrap`) produces a working dev environment on macOS and Linux.
- AC2: Repo structure matches: `services/auth-svc`, `services/briefing-svc`, `services/search-svc`, `services/messaging-svc`, `apps/web`, `packages/shared-types`, `infra/`.
- AC3: Pre-commit hooks run ESLint, Prettier, ruff, and mypy on staged files; fail fast.
- AC4: `main` branch is protected: requires 1 review, passing CI, signed commits.
- AC5: `CODEOWNERS` file routes reviews by directory.
- AC6: README documents bootstrap, common commands, and architectural overview link.

### Definition of Done
- Merged to `main` via PR with passing CI.
- Onboarding doc in `/docs/dev-setup.md` — verified by one engineer not the author following it from scratch.

---

## Ticket: INFRA-2 — CI/CD Pipelines (Backend + Frontend)

**Type:** Task · **Priority:** P0 · **Estimate:** 5 pts · **Owner:** DevOps
**Depends on:** INFRA-1
**Blocks:** AUTH-2, FE-1

### Description
GitHub Actions workflows for: PR validation (lint, typecheck, unit tests, build), staging deploy on `main` merge, manual production promote. Backend services build to Docker images pushed to a private registry; frontend builds to a static bundle. All deploys go to Railway in S1 (per PRD §5.2 — Railway for MVP, Fargate later).

### Acceptance Criteria
- AC1: PR pipeline runs in <5 min for a single-service change.
- AC2: Each service has its own pipeline; matrix strategy avoids running unrelated tests on small PRs (path-based filters).
- AC3: Staging deploys are automatic on `main` merge; production deploys are manual with required approval.
- AC4: Failed pipelines post a Slack notification to `#engineering-alerts`.
- AC5: Coverage report uploads to Codecov (or equivalent); coverage gate ≥ 70% for new code.
- AC6: Image tags follow `{service}:{git-sha}` + `{service}:staging` + `{service}:production` convention.

### Definition of Done
- One real PR for AUTH-2 successfully ships through PR → staging → production via this pipeline.

---

## Ticket: INFRA-3 — Cloud Environment + Observability Baseline

**Type:** Task · **Priority:** P0 · **Estimate:** 5 pts · **Owner:** DevOps
**Depends on:** INFRA-2
**Blocks:** AUTH-2 (production deploy)

### Description
Provision Railway environments for Dev, Staging, Production. Set up AWS Secrets Manager (or Railway secrets — pick one and document). Wire Sentry into all backend services and the frontend. Set up basic Datadog (or Grafana Cloud — pick one) APM with auto-instrumentation. No alerts wired yet (that's Sprint 2 once we have flows to alert on).

### Acceptance Criteria
- AC1: Three environments — Dev, Staging, Production — provisioned with isolated databases (PostgreSQL 16) and Redis instances.
- AC2: Secrets management chosen and documented in ADR (Architectural Decision Record); no `.env` files committed.
- AC3: Sentry capturing errors from all services; PR check fails if Sentry DSN not configured for new service.
- AC4: APM tracing live in Staging and Production; can see span timing for a sample request.
- AC5: A "hello world" Node service and a "hello world" Python service both deploy and report metrics.
- AC6: ADR documents the Railway → ECS Fargate migration trigger (per PRD §5.4: at M4 / Beta scale).

### Definition of Done
- Demo: tail logs from one production service in Datadog and intentional 500 from staging shows in Sentry.

---

## Ticket: AUTH-1 — Database Schema for Users, Agencies, LGPD Audit

**Type:** Task · **Priority:** P0 · **Estimate:** 3 pts · **Owner:** Tech Lead
**Depends on:** INFRA-3
**Blocks:** AUTH-2, AUTH-4, all subsequent backend tickets

### Description
Implement initial PostgreSQL schema covering S1 scope only: `users`, `agencies`, `lgpd_jobs`, `audit_log`. Use a migration tool (Flyway, Alembic, or Prisma — pick one and ADR it). Schema must match PRD §8.1 exactly for these tables.

### Acceptance Criteria
- AC1: Migrations are versioned, reversible, and run automatically on service startup in non-production environments.
- AC2: Tables created: `users`, `agencies`, `lgpd_jobs`, `audit_log`. Other tables from PRD §8.1 deferred to S2.
- AC3: `users.lgpd_consent_at` is `NOT NULL` — enforced at DB level.
- AC4: `audit_log` table has columns for: `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `details JSONB`, `created_at`.
- AC5: Indexes: `users(email)` UNIQUE, `users(agency_id)`, `lgpd_jobs(user_id, status)`, `audit_log(actor_user_id, created_at DESC)`.
- AC6: Seed script for local dev creates: 1 admin, 1 agency owner, 3 brokers under that agency.

### Definition of Done
- Migrations run cleanly forward AND backward on staging.
- Seed script tested on a clean DB.
- ADR for migration tool choice merged.

---

## Ticket: AUTH-2 — Auth Service: JWT, Email/Password Signup & Login

**Type:** Story · **Priority:** P0 · **Estimate:** 5 pts · **Owner:** Backend Engineer (Node)
**Depends on:** AUTH-1, INFRA-3
**Blocks:** FE-2, all gated endpoints in later sprints

### Description
Stand up the Node-based auth service exposing email/password signup, login, refresh, logout. JWT access tokens (1h TTL), refresh tokens (30d TTL, stored hashed in DB). OAuth Google deferred to S2 explicitly to fit S1 budget.

### Acceptance Criteria
- AC1: `POST /auth/signup` accepts `{email, password, name, phone, lgpd_consent: true}`. Returns `{access_token, refresh_token, user}`. Rejects without consent.
- AC2: Password hashed with argon2id; minimum 10 chars enforced server-side.
- AC3: `POST /auth/login` returns same shape. Returns `401` with code `INVALID_CREDENTIALS` on failure (no info leak — same code for unknown email vs wrong password).
- AC4: `POST /auth/refresh` validates refresh token, rotates it, returns new access token.
- AC5: `POST /auth/logout` revokes refresh token (DB flag).
- AC6: Rate limit: 5 signups per IP per hour, 10 login attempts per email per 15 min.
- AC7: All auth events logged to `audit_log`.
- AC8: Secrets (JWT secret, argon2 pepper) loaded from Secrets Manager, not env files.

### Definition of Done
- Postman/Bruno collection covering all 4 endpoints, committed to repo.
- Integration tests covering happy path + 5 failure modes.
- Load test: 100 concurrent logins succeed under 200ms p95.

---

## Ticket: AUTH-3 — Row-Level Security Policies for Multi-Tenant Tables

**Type:** Task · **Priority:** P0 · **Estimate:** 3 pts · **Owner:** Tech Lead
**Depends on:** AUTH-1
**Blocks:** All future tickets touching user-scoped data (briefings, clients, messages)

### Description
Establish PostgreSQL RLS pattern that subsequent tickets inherit. Set up `app.current_user_id` session variable convention; write helper functions; apply RLS to `users` table as a proof of concept. Subsequent tables in S2+ inherit this pattern.

### Acceptance Criteria
- AC1: ADR documents the RLS pattern, including how the API gateway sets `app.current_user_id` per request via `SET LOCAL`.
- AC2: `users` table has RLS policy: a broker can SELECT only their own row; an admin can SELECT all.
- AC3: Test suite verifies RLS: query as broker A cannot see broker B's row even with raw SQL.
- AC4: Helper SQL function `current_app_user()` returns UUID from session var; throws if not set.
- AC5: Service layer enforces `SET LOCAL app.current_user_id = $1` at the start of every request transaction.

### Definition of Done
- Demo: two brokers signed in concurrently; logs prove they cannot read each other's data even at SQL level.

---

## Ticket: AUTH-4 — LGPD Consent Capture & Deletion Endpoint (MVP-Blocking)

**Type:** Story · **Priority:** P0 · **Estimate:** 3 pts · **Owner:** Backend Engineer (Node)
**Depends on:** AUTH-1, AUTH-2
**Blocks:** Public launch (LGPD MVP-blocking per PRD §5.5)

### Description
Implement the LGPD consent capture (already integrated in AUTH-2 signup) plus the MVP-blocking deletion endpoint. Export endpoint deferred to S7 per PRD §5.5. Manual deletion playbook for first 14 days post-launch is delivered alongside this ticket as ops documentation.

### Acceptance Criteria
- AC1: `POST /lgpd/delete` accepts authenticated user request; creates `lgpd_jobs` row with `status=requested`.
- AC2: 7-day grace period: user can `POST /lgpd/delete/cancel` within the window to abort.
- AC3: After 7 days, automated job moves status to `in_progress`; deletion completes within 30 days.
- AC4: Deletion cascades correctly: user record marked deleted (anonymized), audit_log entries retain tokenized actor_user_id (24mo legal retention).
- AC5: All deletion events logged to `audit_log`.
- AC6: Ops playbook (`/docs/ops/lgpd-manual-deletion.md`) covers manual deletion if automation fails, with step-by-step SQL and verification checklist.
- AC7: Counsel sign-off on the playbook (per PRD §5.5 "Legal dry-run") — sign-off attached as PR comment before merge.

### Definition of Done
- Counsel-signed playbook in repo.
- End-to-end test: signup → delete request → wait 7d (mocked time) → verify deletion completed.
- Manual dry-run executed by ops with counsel observing; no findings.

---

## Ticket: FE-1 — React App Scaffold and Design System Tokens

**Type:** Story · **Priority:** P0 · **Estimate:** 5 pts · **Owner:** Frontend Engineer + Designer
**Depends on:** INFRA-1, INFRA-2
**Blocks:** FE-2, all subsequent frontend work

### Description
Initialize the web app with Vite + React 18 + TypeScript + Tailwind + shadcn/ui. Establish design tokens (colors, spacing, typography, radii) aligned with the design system Designer is delivering. Set up TanStack Query for server state and a basic routing scaffold (TanStack Router or React Router — pick one and ADR it).

### Acceptance Criteria
- AC1: `pnpm dev` from `apps/web` boots in <2s with HMR working.
- AC2: shadcn/ui installed; at least these primitives wired and rendering on a `/kitchen-sink` route: Button, Input, Card, Dialog, Toast, Form.
- AC3: Tailwind config consumes design tokens from a single source (`packages/design-tokens`) — Designer can update tokens without touching components.
- AC4: Storybook or equivalent component preview running in CI; visual diff snapshots taken.
- AC5: TypeScript strict mode on; no `any` allowed (enforced in lint).
- AC6: Routing scaffold has placeholder routes: `/`, `/login`, `/signup`, `/dashboard` — all rendering "Coming soon" with the design system shell.
- AC7: i18n scaffold ready (i18next or equivalent) with `pt-BR` as default — even if only the placeholder strings are translated. Per PRD §3.2: UTF-8 + accent-tolerant + emoji-safe inputs verified.

### Definition of Done
- `/kitchen-sink` reviewed and approved by Designer.
- Storybook published to a static URL for stakeholder review.
- ADR for routing library merged.

---

## Ticket: FE-2 — Authentication UI Flows (Signup with Consent + Login)

**Type:** Story · **Priority:** P0 · **Estimate:** 5 pts · **Owner:** Frontend Engineer
**Depends on:** FE-1, AUTH-2, AUTH-4
**Blocks:** All authenticated flows in later sprints

### Description
Build the signup and login screens consuming AUTH-2 and AUTH-4. Signup flow MUST include the explicit LGPD consent checkbox separate from the ToS checkbox (per PRD §5.5). Tokens persisted in memory + httpOnly cookie for refresh.

### Acceptance Criteria
- AC1: Signup form: name, email, password, phone (E.164 with country picker default +55), ToS checkbox, **separate** LGPD consent checkbox. Submit disabled until both checked.
- AC2: LGPD consent text links to a hosted privacy policy page (placeholder OK in S1).
- AC3: Login form: email, password, "remember me" toggle that extends refresh token cookie expiry.
- AC4: Both forms validate on blur and on submit; errors render with the design system's error pattern.
- AC5: 401/403 on protected routes redirects to `/login?return_to={original_path}`.
- AC6: Session expiry triggers a silent refresh; if refresh fails, user is logged out with a toast.
- AC7: Logout button in app shell calls `/auth/logout` and clears local session.
- AC8: Accessibility: forms pass axe-core scan; all inputs have labels; tab order is sensible.

### Definition of Done
- E2E Playwright test (delivered in QA-1's framework): signup → logout → login → access dashboard.
- Designer review for visual + interaction quality.
- Lighthouse a11y score ≥ 95 on both pages.

---

## Ticket: QA-1 — Test Framework Setup (Unit + E2E)

**Type:** Task · **Priority:** P0 · **Estimate:** 3 pts · **Owner:** QA Engineer
**Depends on:** INFRA-1
**Blocks:** Definition of Done for AUTH-2 and FE-2

### Description
Establish the test stacks every other ticket relies on for its DoD. Unit: Vitest (frontend), pytest (Python services), Vitest or Jest (Node services). E2E: Playwright for browser flows. Set up CI integration so PR checks run all of them. No actual test coverage of features in this ticket beyond a smoke test.

### Acceptance Criteria
- AC1: `pnpm test` from repo root runs every workspace's unit tests and reports a combined summary.
- AC2: Playwright configured with three browsers (Chromium, Firefox, WebKit); tests run headless in CI, headed locally.
- AC3: One smoke E2E test exists: opens the deployed staging frontend and verifies the homepage renders.
- AC4: Coverage gate enforced in CI: PR fails if coverage on changed files drops below 70%.
- AC5: Test data factories scaffolded for users, agencies (using Faker or equivalent).
- AC6: Documentation in `/docs/testing.md` covers: how to write a unit test in each language, how to write a Playwright test, how to run locally, how to debug a CI failure.

### Definition of Done
- One real test from AUTH-2 and one from FE-2 land using these frameworks.
- CI failure on a deliberately broken test correctly blocks the PR.

---

## Sprint 1 Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Tooling decisions (migration tool, routing library, observability vendor) cause analysis paralysis | Medium | Tech Lead owns ADRs by Wk1 day 3; defaults: Prisma, TanStack Router, Datadog. Engineer can override with 30-min discussion, no longer. |
| Counsel sign-off on LGPD playbook (AUTH-4) blocks merge | Medium | Counsel briefed Wk1 day 1; playbook draft delivered Wk1 day 5; review window Wk2 day 1–3. |
| Designer half-time capacity bottlenecks FE-1 | Low | Designer delivers tokens by Wk1 EOD; component-level review can happen async. |
| Staging environment instability slows DoD | Low | INFRA-3 prioritized first; if unstable, tickets fall back to PR-level smoke tests instead of staging-deployed verification. |

## Sprint 1 Done Definition (sprint-level)

Sprint is done when:
1. Every ticket above is merged with passing CI and DoD met.
2. A new engineer can clone the repo, run bootstrap, and have a working dev environment in <30 min.
3. A user can sign up via the deployed staging frontend, see the dashboard placeholder, log out, and log back in.
4. Sentry has captured at least one real error and APM has at least 24h of trace data.
5. Counsel has signed off on the manual LGPD deletion playbook.
6. ADRs exist in `/docs/adr/` for: migration tool, routing library, observability vendor, secrets management, RLS pattern.

## Out of Scope for Sprint 1 (explicitly deferred)

- OAuth Google → S2
- Briefing extraction (Claude integration) → S2
- HITL review queue → S2
- Property data model → S2 (with sources)
- Any user-visible feature beyond auth → S2+
- Production alerting rules → S2 (need flows to alert on first)
- Source 1/2/3 integration → S3 (Scraping Engineer uses S1 capacity for partner negotiation per §3.4)
