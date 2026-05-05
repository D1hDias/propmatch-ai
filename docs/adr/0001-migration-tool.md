# ADR-0001: Database Migration Tool — Prisma

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Tech Lead

## Context

PropMatch AI runs PostgreSQL 16 as its primary store. We have multiple services (Node and Python) that share the same database in MVP. We need a migration tool that:

- Versions schema changes deterministically.
- Supports reversible migrations.
- Generates strongly-typed clients for Node services.
- Plays well with TypeScript service code (the bulk of the schema-touching code is in auth-svc and messaging-svc, both Node).
- Can be invoked from CI for automated testing.

The decision needs to be made in Sprint 1 (per ticket AUTH-1) so subsequent sprints can build on a stable migration foundation.

## Alternatives considered

### Alternative A: Prisma
- Pro: Best-in-class TypeScript codegen; idiomatic; large ecosystem.
- Pro: Migration files are SQL with metadata, readable and reviewable.
- Pro: First-class support for shadow database (catches schema drift in CI).
- Con: Python services don't get a typed client; they use SQLAlchemy or raw SQL.
- Con: Some advanced PostgreSQL features (partitioning, custom types) require raw SQL escape hatches.

### Alternative B: Flyway
- Pro: Language-agnostic — same migrations work for Node and Python services.
- Pro: SQL-only migrations; no abstraction over the DSL.
- Con: No typed client generation; we'd write our own DAL or use a separate ORM.
- Con: Heavier ops — needs a JVM in CI and locally.

### Alternative C: Alembic + sqlc-style codegen for Node
- Pro: Alembic is mature and Pythonic.
- Con: Two tools (Alembic for migrations, separate codegen for Node types) — more moving parts.
- Con: We end up writing TypeScript types twice or maintaining a translation layer.

### Alternative D: Hand-written migrations + raw SQL everywhere
- Pro: Maximum control.
- Con: We reinvent migration ordering, reversal, and CI integration.
- Con: No type safety in Node services.

## Decision

Use **Prisma** for migrations and Node-side database access. Python services use SQLAlchemy 2.0 (with raw SQL fallback for performance-critical queries) reading the same schema, but Prisma is the source of truth — Python migrations are not allowed; Python services consume the schema Prisma manages.

## Rationale

The bulk of schema-touching code (auth-svc, messaging-svc) is Node. Prisma's TypeScript codegen provides the most leverage there. Python services in MVP touch the schema in narrow ways (briefing-svc reads/writes briefings; search-svc reads properties), and SQLAlchemy 2.0's typed core is good enough for those.

Centralizing migration ownership in one tool prevents schema drift across services. Forbidding Alembic-style Python migrations enforces the centralization.

## Consequences

### Positive
- TypeScript services get end-to-end type safety from schema to API response.
- Single migration tool to learn and operate.
- Fast feedback loop in CI (Prisma validates schema, runs migrations, runs tests).
- Migrations live in one place, reviewed in PRs against the schema PR template.

### Negative
- Python services have less ergonomic database access. Mitigated by SQLAlchemy 2.0's typed core and raw SQL escape hatches for hot paths.
- Prisma has historical performance gotchas (N+1 in nested includes); engineers must be aware.
- Lock-in to Prisma's migration format. Migrating away later would require rewriting migrations or running them manually.

### Neutral
- We commit `prisma/schema.prisma` as the canonical schema definition. Generated artifacts (`@prisma/client`) are not committed but regenerated in CI and on `pnpm install`.

## When to revisit

- If Python services grow to dominate schema-touching workloads, reconsider whether a Python-first migration tool would serve better.
- If Prisma's performance becomes a bottleneck and we can't escape via raw SQL, reconsider going to a thinner ORM (Kysely on Node) plus separate migrations (Flyway).
- If the team grows past 10 engineers and migration conflicts become a coordination problem, reconsider whether per-service migrations would help.

## References

- Sprint 1 ticket AUTH-1
- PRD §8 (Data Models)
- https://www.prisma.io/docs
