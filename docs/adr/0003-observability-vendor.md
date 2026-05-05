# ADR-0003: Observability Vendor — Datadog + Sentry

**Status:** Accepted
**Date:** 2026-05-04
**Author:** DevOps / SRE

## Context

PropMatch AI needs APM, logs, errors, and metrics from day one. Without observability we cannot meet the PRD's SLAs (search latency p95 < 8s, HITL p95 review < 3 min, source success rate ≥ 95%) because we cannot see them.

Decision must land in Sprint 1 (per ticket INFRA-3). MVP runs on Railway; production targets AWS ECS Fargate from M4. The choice should work in both environments.

## Alternatives considered

### Alternative A: Datadog (APM + logs + metrics) + Sentry (errors)
- Pro: Datadog APM is best-in-class; auto-instrumentation across Node and Python.
- Pro: Sentry is the standard for frontend error capture and works equally well for backend.
- Pro: Service map, distributed tracing, log correlation, custom metrics — all included.
- Pro: Both vendors have generous startup pricing programs.
- Con: Two vendors to manage. Two billing relationships.
- Con: Datadog pricing scales aggressively as host count and volume grow.

### Alternative B: Grafana Cloud (Loki + Tempo + Prometheus + Grafana)
- Pro: Single vendor; cheaper at scale.
- Pro: Open standards (Prometheus, OpenTelemetry).
- Pro: Self-hostable later if vendor cost becomes prohibitive.
- Con: APM is less polished than Datadog's; auto-instrumentation has rougher edges.
- Con: Errors via Sentry-style flow require additional setup.
- Con: More configuration burden upfront — we'd need a half-time SRE just to keep dashboards healthy.

### Alternative C: New Relic
- Pro: Full-stack observability in one product.
- Con: UX is dated; engineers actively dislike using it.
- Con: Pricing model (per-user) discourages broad team access.

### Alternative D: AWS-native (CloudWatch + X-Ray) + Sentry
- Pro: Lowest cost; integrated with eventual ECS Fargate target.
- Con: CloudWatch UX is poor for debugging; engineers hate it.
- Con: X-Ray distributed tracing is functional but lacks the polish of Datadog or Tempo.
- Con: We'd be locked into AWS for observability before we're locked into AWS for compute.

## Decision

**Datadog for APM, logs, and metrics. Sentry for error tracking.**

## Rationale

Speed of debugging matters more than vendor cost in the first 12 months. Datadog auto-instrumentation gets us tracing across all four services with minimal code changes; Sentry's frontend SDK handles browser errors and source maps gracefully. The two-vendor cost is real but acceptable at our scale; both have startup-friendly pricing.

We accept the lock-in risk because both vendors export OpenTelemetry-compatible data; switching to Grafana Cloud later would require dashboard rebuild but not application code changes if we instrument via OTel where possible.

## Consequences

### Positive
- Distributed tracing live from Sprint 1, with auto-instrumentation handling 90% of cases.
- Source-mapped frontend errors in Sentry; debugging production issues from the broker's browser is realistic.
- Service map visualizes inter-service dependencies — useful for onboarding and incident response.
- Custom metrics (briefing-to-clipboard time, HITL queue depth, source health) integrate cleanly into Datadog dashboards.

### Negative
- Two vendor relationships, two SOC reports to gather, two DPA agreements.
- Datadog cost grows with host count and log volume; we'll need cost monitoring from M4 onwards.
- Some lock-in — Datadog dashboards and alerts don't export cleanly to other tools.

### Neutral
- We instrument with OpenTelemetry SDKs where possible to keep the door open for vendor change later.
- PII is filtered at the SDK level before transmission to either vendor.

## When to revisit

- At Beta (M4) when we move to Fargate — confirm Datadog pricing is acceptable at projected scale.
- At GA (M8) — if Datadog cost exceeds R$ 10k/month, evaluate Grafana Cloud migration.
- If Sentry pricing model changes meaningfully.

## References

- Sprint 1 ticket INFRA-3
- PRD §10.2 (Measurement Methods)
- https://docs.datadoghq.com
- https://docs.sentry.io
