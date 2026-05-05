# ADR-0008: Simplified Observability — Sentry + BetterStack

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Tech Lead
**Supersedes:** ADR-0003 (Datadog + Sentry)

## Context

The original observability decision (Datadog APM + logs + metrics, plus Sentry for errors) assumed Railway/AWS hosting with managed agents. On a Hostinger VPS KVM 2:

- The Datadog Agent itself uses ~250 MB RAM and adds CPU overhead — meaningful share of an 8 GB box.
- Datadog pricing scales aggressively; expected MVP cost ~R$ 600-1500/mo, which is more than the VPS itself.
- The Datadog feature set (host metrics, container metrics, network, security, etc.) is overkill for a single-VPS monolithic deploy.

We still need: errors, uptime, basic application metrics, structured logs we can query.

## Alternatives considered

### Alternative A: Sentry (errors) + BetterStack (uptime + log management) + nginx access logs
- Pro: Sentry handles errors better than anything; we keep that.
- Pro: BetterStack is cheap (~$20/mo for our scale), good UX, log search included.
- Pro: nginx/Caddy access logs are free, on-disk, queryable with `awk`/`jq`.
- Pro: No agent on the VPS; lower memory and CPU footprint.
- Con: No distributed tracing. Acceptable for a monolith — there's no distribution to trace.
- Con: Custom metrics need to be emitted as structured logs and counted in BetterStack queries; less polished than Datadog dashboards.

### Alternative B: Grafana Cloud (Loki + Tempo + Prometheus + Grafana)
- Pro: More powerful; everything in one pane.
- Pro: Open standards (OpenTelemetry); portable.
- Con: Requires running a Grafana Agent on the VPS (~150 MB RAM, smaller than DD but still meaningful).
- Con: More configuration burden. We'd need a half-time SRE to keep dashboards healthy.
- Con: For our scale, paying for Grafana Cloud's tiers is similar cost to BetterStack but more setup work.

### Alternative C: Self-host (Prometheus + Loki + Grafana on the same VPS)
- Pro: Free.
- Con: Eats the VPS's RAM. Same problem we're trying to avoid.
- Con: Operating monitoring on the same box you're monitoring is a known anti-pattern.

### Alternative D: Just Sentry + Cloudflare Analytics + manual log review
- Pro: Cheapest.
- Con: No log aggregation; debugging incidents means SSHing into the VPS.
- Con: No proactive uptime alerts beyond Sentry's reach.
- Con: Not enough.

## Decision

**Sentry for errors + BetterStack for uptime and log management + nginx/Caddy access logs.**

OpenTelemetry-compatible instrumentation in code (using `@sentry/node` which supports OTel) so that if we later move to a tracing-capable platform, the instrumentation port without rewrite.

## Rationale

For a VPS-hosted monolith at MVP scale, distributed tracing is not the gap. The actual gaps are: when something breaks, do we know? when we want to debug, can we find the logs quickly? when uptime degrades, do we get paged? Sentry + BetterStack covers all three at a fraction of Datadog's cost without putting a heavy agent on a small VPS.

We accept the loss of pretty Datadog dashboards. Brokers don't care about pretty dashboards; they care about the product working.

## Consequences

### Positive
- Total observability cost ~R$ 100-150/mo (Sentry team plan + BetterStack starter), vs Datadog's R$ 600+.
- Zero agent footprint on the main VPS (Sentry SDK is in-process; BetterStack pulls logs via syslog or HTTP, not via agent).
- Simpler setup; less SRE skill required to operate.
- Engineers can read access logs with regular tools (`grep`, `jq`, `awk`).

### Negative
- No distributed tracing. Mitigation: monolith means there's no distribution to trace. Within a single process, Sentry's spans handle "trace the slow request" use cases.
- Custom dashboards are simpler in BetterStack's UI than Datadog's. Acceptable.
- Migration to Datadog (or Grafana Cloud) later is straightforward but means rebuilding dashboards.

### Neutral
- We instrument code with OpenTelemetry-compatible APIs (`@sentry/node` exposes them) so the instrumentation is portable.
- PII filtering happens at the Sentry SDK level before transmission.

## What we monitor

- **Errors:** anything thrown that isn't a known `AppError` with status < 500. Sentry captures.
- **HTTP errors:** 5xx responses. Sentry custom integration.
- **Latency:** p50, p95, p99 for each route. Sentry Performance.
- **Uptime:** `/healthz` (every 1 min) and `/readyz` (every 5 min) from BetterStack global probes.
- **Custom metrics (emitted as structured logs):**
  - briefing-to-clipboard time (per briefing)
  - HITL queue depth (every 30s)
  - source success rate (per call)
  - HITL p50/p95/p99 review time (rolling 5-min window)
- **Server health:** RAM usage, disk usage, load average — exposed at `/internal/health` and pulled by BetterStack.

## Alerts

### Page (PagerDuty or BetterStack on-call)
- 5xx error rate > 1% over 5 min
- p95 search latency > 8s for 5 min
- Uptime check fails 2 consecutive times
- Postgres or Redis down
- Disk usage > 85%

### Slack-only (no page)
- HITL queue depth > 50
- Single-source success rate < 80% over 1h
- Sentry new-error spikes
- Daily LGPD job report

## When to revisit

- At Beta (M4) when we move off VPS — re-evaluate whether Datadog's tracing is worth the cost on a multi-host deploy.
- If MTTR on production issues exceeds 30 min consistently — investigate whether a richer tracing tool would help.
- If we add a meaningful second service (e.g., scraper fleet) and need cross-service tracing.

## References

- ADR-0003 (superseded)
- `docs/architecture.md` § Observability
- https://docs.sentry.io
- https://betterstack.com
