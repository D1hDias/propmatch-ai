# ADR-0004: Secrets Management — AWS Secrets Manager

**Status:** Accepted
**Date:** 2026-05-04
**Author:** DevOps / SRE

## Context

PropMatch AI services need access to secrets: database passwords, JWT signing keys, third-party API keys (Anthropic, Stripe, partner sources), encryption peppers. These secrets must be:

- Centrally managed and rotatable.
- Never committed to git.
- Auditable (who accessed what, when).
- Available to services at runtime in both Railway (MVP) and AWS ECS Fargate (post-Beta).

Decision must land in Sprint 1 (per ticket INFRA-3, AC2).

## Alternatives considered

### Alternative A: AWS Secrets Manager
- Pro: Industry standard; battle-tested.
- Pro: Native rotation hooks for some secret types (RDS, Redshift, etc.).
- Pro: Audit logs via CloudTrail.
- Pro: SDK clients in every language we use.
- Pro: Works in Railway (via API access) and in Fargate (via task role).
- Con: Cost: $0.40 per secret per month + API call charges. Negligible at our scale.
- Con: Requires AWS account from day one even though MVP runs on Railway.

### Alternative B: Railway native secrets
- Pro: Built into Railway; zero setup.
- Pro: Free.
- Con: We don't stay on Railway forever. Migrating to Fargate (post-Beta) means re-implementing secret injection.
- Con: No central audit log.
- Con: Rotation is manual.

### Alternative C: HashiCorp Vault
- Pro: Most powerful and flexible.
- Pro: Open source option exists.
- Con: Heavy. We don't have an SRE team that can keep Vault healthy.
- Con: Overkill for current scale.

### Alternative D: Encrypted secrets in git (SOPS, age)
- Pro: Cheap, simple.
- Con: Rotation requires re-encrypting and committing, no audit trail of decryption.
- Con: If a key leaks, every past secret is compromised.
- Con: Not a real secrets management solution; an encrypted backup at best.

## Decision

**AWS Secrets Manager.** Provisioned in Sprint 1 even though MVP runs on Railway; Railway services authenticate via AWS IAM access keys stored in Railway env vars (the bootstrap secret). Production Fargate services authenticate via task IAM roles.

## Rationale

Standardizing on Secrets Manager from day one means zero rework when we move to Fargate. The cost is negligible. The audit log via CloudTrail satisfies LGPD compliance reviews ("who accessed this secret and when").

The bootstrap problem (Railway needs a secret to access AWS) is unavoidable with any centralized solution and is acceptable: the bootstrap secret is the only secret in Railway env vars, and it's narrow-scope (read-only access to Secrets Manager paths matching `propmatch/staging/*` or `propmatch/production/*`).

## Consequences

### Positive
- Single source of truth for secrets across environments.
- Rotation is achievable (manual today, automated later).
- Audit trail satisfies compliance needs.
- No `.env` files committed; pre-commit hook scans for secret patterns.
- Zero code changes when migrating Railway → Fargate.

### Negative
- Sprint 1 setup effort: ~1 day of DevOps time.
- Bootstrap secret in Railway is a small attack surface; we accept this tradeoff.
- AWS account dependency from day one.

### Neutral
- We use a secrets adapter pattern in services. Code calls `secrets.get('jwt-signing-key')`; the adapter handles the AWS API call and caching. Switching providers later means swapping the adapter, not refactoring services.

## When to revisit

- If we move off AWS entirely (very low probability).
- If team operates in regions where Secrets Manager has no presence.
- If volume scales such that the per-secret pricing becomes meaningful (would need ~10,000 secrets — not happening).

## References

- Sprint 1 ticket INFRA-3, AUTH-2
- `docs/security.md`
- https://docs.aws.amazon.com/secretsmanager/
