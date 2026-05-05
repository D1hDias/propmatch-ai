# ADR-0009: Secrets Management on VPS — dotenv-vault + systemd EnvironmentFile

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Tech Lead
**Supersedes:** ADR-0004 (AWS Secrets Manager)

## Context

The original secrets decision (AWS Secrets Manager from day 1, even on Railway, to avoid rework when migrating to Fargate) doesn't fit the new hosting model:

- We're not migrating to AWS post-Beta anymore. The plan is Hostinger VPS → larger VPS or managed (Neon + Render/Fly.io). AWS isn't on the path.
- Standing up an AWS account just to host secrets adds cost ($0.40 per secret + API calls) and an external dependency (AWS API reachability) for a single-VPS deploy.
- The original "bootstrap problem" (Railway needs an AWS key to fetch other secrets) becomes "VPS needs an AWS key to fetch other secrets" — same issue, different host. Why not just store the secrets directly?

We still need: secrets not in git, sync between dev and prod, rotation capability, audit trail.

## Alternatives considered

### Alternative A: dotenv-vault for dev/team sync + systemd EnvironmentFile on VPS
- Pro: Free for our scale.
- Pro: dotenv-vault is purpose-built for this (encrypts `.env`, distributes via CLI, version control friendly).
- Pro: systemd EnvironmentFile is the standard Linux pattern; permissions enforce access (mode 0600, owned by service user).
- Pro: No external API dependency at runtime — secrets are loaded at process start.
- Pro: Audit trail via `git log` (vault file) + filesystem ACLs + sshd logins.
- Con: Rotation is manual: edit env file, reload service. Acceptable for our rotation cadence (quarterly JWT, infrequent for others).
- Con: No fine-grained access control between secrets (any process running as the propmatch user reads all of them). Acceptable: it's one app.

### Alternative B: 1Password CLI integration
- Pro: Excellent UX for humans.
- Pro: Audit trail is solid.
- Pro: We're already using 1Password for the team.
- Con: Requires `op` CLI on the VPS and 1Password Connect or service account setup — extra moving parts.
- Con: At runtime, we'd cache secrets locally anyway (don't want every request to hit 1Password).
- Con: Adds external dependency at deploy/start time.

### Alternative C: HashiCorp Vault
- Pro: Most powerful.
- Con: Needs to be hosted somewhere; running on the VPS competes for RAM; running externally adds cost and a dependency.
- Con: Massive overkill.

### Alternative D: AWS Secrets Manager (the original decision)
- Pro: Industry standard.
- Con: AWS account just for this is wasteful given we're not on AWS.
- Con: Per-secret + API-call costs add up (small but non-zero).
- Con: Outage of AWS API blocks our deploys — unnecessary blast radius.

### Alternative E: Doppler
- Pro: Modern, decent UX, cheap tier.
- Con: Vendor lock-in for a small team.
- Con: Yet another vendor in our stack.

## Decision

**dotenv-vault for dev sync + systemd `EnvironmentFile` on the production VPS.**

For team-wide secret sharing during dev:
```bash
pnpm dotenv-vault pull development
pnpm dotenv-vault push development
```

For production secrets on the VPS, `/etc/propmatch/secrets.env` is mounted into the systemd unit:

```ini
# /etc/systemd/system/propmatch.service
[Service]
EnvironmentFile=/etc/propmatch/secrets.env
ExecStart=/usr/bin/node /opt/propmatch/.next/standalone/server.js
User=propmatch
Group=propmatch
```

File permissions: mode 0600, owner `propmatch:propmatch`. Only `root` and the `propmatch` service user can read.

## Rationale

For a VPS-hosted monolith, storing secrets in a file mounted into the service is the simplest pattern that meets the requirements. dotenv-vault gives us secure team sync for dev. Production secrets are one file, accessible only to the running process and the deploy user.

We trade fine-grained access control (which we don't need — one app, one process, one secrets bundle) for operational simplicity. We trade cloud-managed rotation (which we don't have rotation cadence for) for the ability to edit a file and `systemctl reload`.

This is the right tradeoff at our scale. When we move to Beta+ infrastructure, we revisit.

## Consequences

### Positive
- Zero external dependencies for secret access at runtime.
- Zero monthly cost for secrets management.
- Standard Linux patterns; new engineers onboard fast.
- Deploy doesn't depend on a third-party API being up.

### Negative
- No automatic rotation. We schedule manual rotation quarterly (JWT) or per-event (compromise) and document the procedure in `docs/ops/secrets-rotation.md`.
- All secrets readable by the process. If the Node.js process is compromised, all secrets are compromised. Mitigations: keep the Node user unprivileged, restrict outbound network from the VPS, monitor for anomalies.
- No audit log of "which secret was read when." We accept this; deploy/SSH logs cover the meaningful access events.

### Neutral
- A `secrets adapter` lives in `src/server/lib/secrets.ts` that reads from `process.env`. If we ever move to a managed solution (Vault, Doppler, AWS SM), we swap the adapter without touching application code.

## What about LGPD compliance?

LGPD doesn't mandate a specific secrets management vendor. It requires:
- Secrets not be exposed (✓ — file mode 0600, not in git, not in logs).
- Audit trail of access for security-sensitive operations (✓ — sshd, sudo, deploy logs).
- Reasonable rotation (✓ — manual but scheduled).

A privacy DPO review confirmed this approach is acceptable. Documented in `docs/lgpd-compliance.md`.

## Rotation procedure (summary)

For each secret type:

| Secret | Cadence | Procedure |
|--------|---------|-----------|
| JWT signing key | Quarterly | Generate new, add to env file with both old+new accepted, deploy, wait 30 days, remove old |
| DB password | Bi-annually | Coordinate with DBA — new password, update env file, deploy, drop old |
| Anthropic API key | On personnel change | Console rotation, update env file, deploy |
| Stripe webhook secret | On Stripe-prompted rotation | Console rotation, update env file, deploy |
| Resend API key | Annually or on compromise | Console rotation, update env file, deploy |

Full procedures in `docs/ops/secrets-rotation.md` (TBD).

## When to revisit

- When we have >2 production environments (staging, prod, prod-EU): centralized secrets management starts paying off.
- When we hire a security engineer who wants stricter access control.
- When automated rotation becomes a hard requirement (e.g., a regulator).
- When we move to managed hosting (Render, Fly.io, etc.) — those typically have built-in secrets management we'd use natively.

## References

- ADR-0004 (superseded)
- `docs/security.md` § Secrets management
- `docs/lgpd-compliance.md`
- https://www.dotenv.org/docs/security/vault
