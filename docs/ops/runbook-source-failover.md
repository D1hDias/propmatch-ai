# Runbook: Source Failover (Source 2 → Source 3)

This runbook covers the contingency procedure for swapping Source 2 (scraped portal) to Source 3 (`partner_b`) when Source 2 becomes unviable. The mechanism is a feature-flag flip; the human work is verification and communication.

**Owner:** SRE on-call.
**Estimated time:** 2–4 hours including canary verification.
**Per PRD §3.4 / ADR-0006:** activation SLA is 24 hours from go-decision.

## When to trigger

Any of the following:

1. **Source 2 health < 80% over 24 hours.** Datadog alert `source.portal_x.health_low_24h` fires.
2. **Source 2 success rate degraded for 3+ consecutive days.** Even if 24-hour windows look OK individually.
3. **Cease-and-desist or legal notice from the portal.** Counsel decision; engineering executes.
4. **Sustained scraper bans.** Residential proxy rotation no longer effective; partnership lead has confirmed no near-term unblock path.

Do **not** trigger for transient issues (single source outage < 24h, isolated proxy ban). The system is designed to tolerate those via partial-results messaging.

## Prerequisites (verified before activation)

These should all be true continuously per ADR-0006. If any is false, fix it before triggering — do not "figure it out during an incident."

- [ ] Source 3 (`partner_b`) agreement is signed and in effect.
- [ ] `PartnerBAdapter` is implemented in `services/search-svc/src/search/sources/partner_b.py`.
- [ ] Adapter unit tests pass in CI.
- [ ] Adapter health check from production has been green for ≥ 7 days with the feature flag disabled (loaded but not serving).
- [ ] Datadog dashboard `source-failover-readiness` shows all green checks.

## Decision authority

The activation decision requires sign-off from two of:
- Engineering Manager
- Head of Product
- Privacy/Legal Counsel (mandatory if reason is legal)

Decisions are documented in `ops-log.md` with reason, signers, and timestamp.

## Procedure

### Step 1: Pre-flight checks (10 min)

```bash
# Verify partner_b adapter is healthy in production (with flag still off)
curl -s "https://search-svc.propmatch.ai/internal/sources/partner_b/health" \
  -H "Authorization: Bearer $INTERNAL_OPS_TOKEN" | jq

# Expected response:
# {"source_id": "partner_b", "status": "ok", "last_check": "...", "latency_ms": 280}
```

If status is anything other than `"ok"`, **stop**. Investigate why partner_b is unhealthy before proceeding. Activating an unhealthy source makes things worse.

```bash
# Check current Source 2 (portal_x) health
curl -s "https://search-svc.propmatch.ai/internal/sources/portal_x/health" \
  -H "Authorization: Bearer $INTERNAL_OPS_TOKEN" | jq

# Check current search-svc latency baseline
# (We want to know what "normal" looks like before changing anything)
```

Take screenshots of the Datadog dashboards `search-svc-overview` and `sources-overview` for post-incident comparison.

### Step 2: Notify stakeholders (5 min)

Post in `#incidents` Slack:

> **Source failover initiating: portal_x → partner_b**
> Reason: <one-line reason>
> Decision signers: <names>
> Expected duration: 2–4 hours including canary
> Next update: 30 min

Page the on-call partnership lead so they're available if partner_b's vendor needs to be contacted.

### Step 3: Canary at 5% (30 min)

Activate `partner_b` for 5% of search traffic. **Do not disable `portal_x` yet.** This is comparison mode — both sources serve, and we observe.

```bash
# Set feature flag via the flag service
curl -X PATCH "https://flags.propmatch.ai/api/v1/flags/source.partner_b.enabled" \
  -H "Authorization: Bearer $FLAG_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "rollout_percentage": 5, "rollout_unit": "user_id"}'
```

Monitor for 30 minutes:

| Metric | Source / dashboard | What to watch |
|--------|-------------------|---------------|
| `partner_b` request volume | Datadog `sources-overview` | Should be ~5% of search-svc volume |
| `partner_b` error rate | Datadog `sources-overview` | < 5%; if higher, abort |
| `partner_b` p95 latency | Datadog `sources-overview` | < 4s |
| Briefing-to-clipboard p95 | Datadog `search-svc-overview` | Should not regress vs baseline |
| HITL queue depth | Datadog `briefing-svc-overview` | Should not spike |
| Sentry errors mentioning `partner_b` | Sentry | Triaged before continuing |

Decision gate: if any metric is bad, run **Step 5: Rollback** and stop. The cost of false starts is small; the cost of a bad rollout to 100% is large.

### Step 4: Ramp to 50% then 100%

After 30 minutes of clean canary, ramp:

```bash
# 50%
curl -X PATCH "https://flags.propmatch.ai/api/v1/flags/source.partner_b.enabled" \
  -H "Authorization: Bearer $FLAG_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "rollout_percentage": 50, "rollout_unit": "user_id"}'
```

Monitor for 30 minutes. Same gates as Step 3.

```bash
# 100%
curl -X PATCH "https://flags.propmatch.ai/api/v1/flags/source.partner_b.enabled" \
  -H "Authorization: Bearer $FLAG_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "rollout_percentage": 100, "rollout_unit": "user_id"}'
```

Monitor for 60 minutes at 100%.

### Step 5: Disable Source 2 (only after Source 3 is healthy at 100%)

```bash
curl -X PATCH "https://flags.propmatch.ai/api/v1/flags/source.portal_x.enabled" \
  -H "Authorization: Bearer $FLAG_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

`portal_x` adapter remains in the codebase. Disabling it via flag means it stops being called; it can be re-enabled instantly if Source 3 has issues. Do not delete the adapter for at least 30 days.

### Rollback

If at any point during canary or full rollout something goes wrong:

```bash
# Disable partner_b and restore portal_x as-was
curl -X PATCH "https://flags.propmatch.ai/api/v1/flags/source.partner_b.enabled" \
  -H "Authorization: Bearer $FLAG_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# Verify portal_x is still serving
curl -s "https://search-svc.propmatch.ai/internal/sources/portal_x/health" \
  -H "Authorization: Bearer $INTERNAL_OPS_TOKEN" | jq
```

Rollback should fully restore the prior state within 60 seconds (feature flag propagation). If portal_x is unhealthy too, escalate to the partnership lead immediately — at this point the contingency itself has failed and we are in a real outage.

## Verification (post-activation)

For 48 hours after Step 5, monitor daily:

- `partner_b` health stays > 95%.
- Briefing-to-clipboard p95 stays under 8s.
- Source success rate (any source) ≥ 95%.
- No regression in HITL queue depth.
- No regression in user-reported error rate (Sentry).

If any metric regresses meaningfully, consider re-enabling `portal_x` (flag back on) while Source 3 vendor investigates. We can run both sources simultaneously if helpful.

## Communication

### Internal

Post in `#engineering` and `#product` once the failover completes:

> Source failover from portal_x to partner_b completed at HH:MM.
> Canary 5% → 50% → 100% with no regressions.
> Source 2 (portal_x) flag disabled at HH:MM.
> Datadog dashboards: <links>
> Post-mortem: <link to scheduled doc>

### External (broker-facing)

Brokers should not notice the change. The system handles failover transparently. Do not announce to brokers unless:

- There is an associated outage they need to know about.
- The failover is permanent and changes any visible behavior (e.g., result counts shift meaningfully because the source's coverage differs).

If a public statement is needed, it goes through the comms team, not engineering.

## Post-mortem (within 5 business days)

Write a blameless post-mortem covering:

- Why was the failover triggered?
- Were prerequisites met when needed?
- How did the canary perform?
- Were there any surprises (latency, coverage, edge cases)?
- What gaps in monitoring would have given us earlier warning?
- Any ADR updates needed?

The post-mortem is shared with the team and reviewed in the next engineering all-hands.

## Failure modes

| Failure | Response |
|---------|----------|
| `partner_b` health drops mid-rollout | Roll back per Step 5 procedures; investigate vendor side |
| Both sources unhealthy simultaneously | Treat as P0 outage; partial-results messaging engages; partnership lead pages vendor escalation contacts |
| Feature flag service itself is down | We have a configuration-fallback default in code; if flag service is unreachable, the most recent cached value is used. If that's stale, contact the SRE on-call to flip the static fallback in `services/search-svc/src/search/config.py` (requires a deploy) |
| Source 2 contractually cannot be disabled (improbable, but) | Counsel decision; technical execution unchanged |

## Drill schedule

This runbook is exercised quarterly via a non-production drill: enable `partner_b` at 5% in staging, verify metrics, disable, verify rollback. The drill confirms readiness and trains the on-call rotation.

The drill schedule lives in the on-call playbook.

## Approvals

- [ ] Tech Lead — date
- [ ] SRE Lead — date
- [ ] Privacy/Legal Counsel — date (consulted, not signed unless trigger reason is legal)
