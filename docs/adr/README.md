# Architecture Decision Records

ADRs capture the *why* behind non-trivial decisions in PropMatch AI. They are immutable once accepted. To change a decision, write a new ADR that supersedes the old one.

## Format

See [0000-template.md](0000-template.md). Every ADR has: title, status, context, decision, consequences.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-migration-tool.md) | Database Migration Tool — Prisma | Accepted |
| [0002](0002-routing-library.md) | Frontend Routing Library — TanStack Router | Accepted |
| [0003](0003-observability-vendor.md) | Observability Vendor — Datadog + Sentry | Accepted |
| [0004](0004-secrets-management.md) | Secrets Management — AWS Secrets Manager | Accepted |
| [0005](0005-rls-pattern.md) | Row-Level Security Pattern | Accepted |
| [0006](0006-source-adapter-interface.md) | Source Adapter Interface for Multi-Source Search | Accepted |

## When to write an ADR

You need an ADR when you make a decision that:

- Constrains future implementation choices (library, pattern, protocol).
- Has plausible alternatives that a reasonable engineer might pick later.
- Is hard or expensive to reverse.

You do not need an ADR for:

- Trivial code style choices (settled by linters).
- One-off implementation details that don't constrain anything else.
- Decisions already made in the PRD or in this folder.

## How to propose a new ADR

1. Copy `0000-template.md` to a new file with the next number.
2. Fill in context, alternatives considered, decision, and consequences.
3. Set status to `Proposed`.
4. Open a PR. The PR is the discussion forum.
5. Once accepted, change status to `Accepted` and merge.

## How to supersede an ADR

1. Write a new ADR with status `Proposed`.
2. Reference the old one in the context section.
3. Once accepted, mark the new one `Accepted` and the old one `Superseded by ADR-NNNN`.
4. Old ADRs are never deleted.
