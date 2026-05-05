# Testing Strategy

PropMatch AI's tests exist to make refactoring fearless and to catch regressions before brokers do. This document defines the strategy, the tools, and the conventions.

## Pyramid

We follow a standard test pyramid:

- **Unit tests** (most numerous) — pure functions, single classes, no I/O.
- **Integration tests** — service against a real database, real Redis, mocked external APIs.
- **E2E tests** (fewest) — full user flows in a browser against a deployed staging environment.

Coverage thresholds:
- New code: ≥ 70% line coverage on changed files. Enforced in CI.
- Critical paths (auth, briefing extraction, dedup, LGPD endpoints): ≥ 90%.

## Stacks

| Layer | Tool |
|-------|------|
| Frontend unit | Vitest + React Testing Library |
| Frontend E2E | Playwright (Chromium, Firefox, WebKit) |
| Node services | Vitest |
| Python services | pytest + pytest-asyncio |
| Load testing | k6 |
| Visual regression | Storybook + Chromatic (Phase 2) |

## Conventions

### File location

- Unit tests live next to the code: `foo.ts` → `foo.test.ts`. Same for Python.
- Integration tests live in `tests/integration/` per service.
- E2E tests live in `apps/web/e2e/`.

### Naming

- Test files end in `.test.ts` (TypeScript) or `_test.py` (Python).
- Test names describe behavior in the present tense:
  - ✅ `extracts city from briefing with explicit neighborhood`
  - ❌ `should extract city`, `extract_city_test`

### Structure

Arrange-Act-Assert. No more than one `act()` and one cluster of assertions per test. If a test needs two acts, it is two tests.

```typescript
test('rejects signup without LGPD consent', async () => {
  // Arrange
  const payload = { email: 'a@b.com', password: 'secret123', name: 'A', phone: '+5511987654321' };

  // Act
  const res = await client.post('/auth/signup', payload);

  // Assert
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_FAILED');
  expect(res.body.error.details.field_errors).toContainEqual({ field: 'lgpd_consent', message: expect.any(String) });
});
```

### Test data

- Factories for entities: `userFactory()`, `briefingFactory()`. Defined per service in `tests/factories/`.
- Faker (`@faker-js/faker` for Node, `Faker` for Python) generates realistic-looking data.
- Brazilian locale where it matters (names, addresses, phone numbers).

## Unit tests

Unit tests cover pure logic. They run in milliseconds. They do not touch the network, the disk, or a real database.

### Frontend unit examples

- A reducer-like helper produces the right next state given a prior state and an action.
- A formatter renders a property card to the expected DOM structure.
- A zod schema rejects an invalid briefing input with the right error path.

### Backend unit examples

- The fit-score function returns 100 for an exact-match property.
- The address normalizer collapses "R. Domingos de Morais" and "Rua Domingos de Morais" to the same canonical form.
- The geohash dedup function flags two listings within the same geohash-7 cell with matching bedrooms as duplicates.

## Integration tests

Integration tests cover service boundaries with real infrastructure but mocked external APIs.

### Setup

- Each test spins up a fresh Postgres schema (testcontainers) or rolls back a transaction at the end.
- Redis is real (a separate test instance).
- External APIs (Claude, partner sources, WhatsApp) are mocked at the HTTP layer using `nock` (Node) or `respx` (Python).

### What integration tests cover

- HTTP handler behavior end-to-end within a service.
- RLS policies — verify a query as broker A cannot see broker B's data.
- Database constraints — verify NOT NULL, CHECK, UNIQUE behavior on real schema.
- Migration up/down — every migration runs forward and backward in CI.
- Idempotency — replaying a request with the same `Idempotency-Key` returns the cached response.

### What integration tests do not cover

- Timing / latency. Use load tests for that.
- Cross-service flows. Use E2E for that.
- UI rendering. Use frontend unit + E2E for that.

## E2E tests

E2E tests cover the workflows brokers actually use, against a deployed staging environment, in a real browser.

### Critical flows (must have E2E coverage by MVP)

1. Signup with LGPD consent → dashboard appears.
2. Login → submit briefing → see ranked grid → copy WhatsApp message.
3. Save briefing under a guest client → return next day → see it in history.
4. Trigger auto-widen → result count increases.
5. Hit a 0-result briefing → see the auto-widen offer with broker-facing PT-BR message.
6. Tier-gated feature attempt as Free user → see upgrade modal.

### Conventions

- Page Object Model. Selectors live in `e2e/pages/`.
- Selectors use `data-testid`. Don't use CSS classes — they break under refactor.
- Tests are independent. Each creates its own user via the API, then logs in via the UI.
- Screenshots and video on failure, retained for 7 days.

### Running

```bash
pnpm e2e         # headless, all browsers
pnpm e2e:headed  # headed, Chromium only
pnpm e2e:debug   # Playwright inspector
```

## Test data and fixtures

- Briefing fixtures: 50 hand-curated real-world Portuguese briefings, labeled with expected extracted criteria. Lives in `services/briefing-svc/tests/fixtures/briefings.json`. This is the ground truth for NLP accuracy benchmarks.
- Property fixtures: 200 property records covering common edge cases (missing fields, unusual prices, ambiguous locations). Lives in `services/search-svc/tests/fixtures/properties.json`.
- Both fixture sets grow over time. Bug fixes that involve a problematic input add that input to the fixture set.

## NLP accuracy benchmarks

Briefing extraction is judged against the labeled fixture set:

- Run nightly in CI.
- Threshold: 90% accuracy on critical fields (city, bedrooms, price_max).
- Drop > 2pp triggers a Slack alert.
- Results visualized in a Datadog dashboard.

This is **not** a normal test — it is a metric. It does not block PRs but does block releases if the threshold is breached.

## Load testing

k6 scripts in `tests/load/`. Run before each major release:

- `briefings_peak.js`: simulates 150 briefings/hour with 15% HITL routing. Verifies p95 latency stays under 8s and HITL queue stays healthy.
- `signup_burst.js`: 100 concurrent signups. Verifies argon2id hashing doesn't choke the auth service.
- `search_concurrent.js`: 50 brokers running 3 concurrent searches each. Verifies concurrency cap and spike throttling work.

Load tests run against a dedicated staging environment, not production.

## Pre-MVP synthetic load injection

PRD §10.4 mandates a synthetic load injection day during pilot week 3. This is k6 driving real briefing volume against a production-like environment with the real HITL reviewer team. The exit criteria match production SLAs (p95 search < 8s, HITL p95 review < 3 min).

## Snapshot tests

Used sparingly. Acceptable for:
- Output of deterministic formatters (e.g., the WhatsApp message formatter).
- shadcn/ui component variants in Storybook.

Not acceptable for:
- Whole-page DOM snapshots — too brittle.
- API response snapshots — assert specific fields instead.

## Mocks and stubs

- Mock at the boundary, not in the middle. Mock the HTTP request to Claude, not the briefing service's internal extraction function.
- Use real implementations of internal collaborators when possible. If the test starts feeling like it's testing the mock, refactor the design instead.

## CI integration

- PR checks: lint, typecheck, unit, integration. Must pass to merge.
- Main branch: full suite including E2E against staging.
- Nightly: NLP accuracy benchmark + load tests + dependency vulnerability scan.

PR coverage diff posted as a comment. PRs that drop coverage on critical paths require explicit reviewer acknowledgment.

## When tests fail in CI

- First, verify locally. CI environment differences (env vars, Postgres version) account for ~20% of "flaky" tests.
- If actually flaky, mark with `@flaky` (or equivalent), file a ticket, and fix within one sprint. Do not let flakes accumulate.
- Quarantining a flake without a fix-by date is forbidden.

## What we explicitly do not test

- Third-party libraries. Trust them or replace them.
- Configuration values. Trust the config schema validation.
- Trivial getters/setters.
- Code paths that only exist for testing.

## Testing checklist for a new ticket

- [ ] Unit tests cover the new logic, including at least one happy path and one failure mode.
- [ ] If the change touches an HTTP handler, an integration test exists.
- [ ] If the change touches a user-visible flow, an E2E test exists.
- [ ] If the change adds a new error code, a test asserts it surfaces correctly.
- [ ] If the change touches a critical path (auth, briefing extraction, dedup, LGPD), coverage on changed files is ≥ 90%.
- [ ] If the change introduces a new fixture or factory, it's documented inline.
