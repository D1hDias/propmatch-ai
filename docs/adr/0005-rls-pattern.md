# ADR-0005: Row-Level Security Pattern

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Tech Lead

## Context

PropMatch AI is multi-tenant from day one: every broker has their own briefings, clients, and messages, and broker A must never see broker B's data. Per PRD §5.8 hard rules, this isolation is enforced at the database layer, not just in application code, because application-level authorization is too easy to forget.

Decision must land in Sprint 1 (ticket AUTH-3) so that all subsequent tables inherit the established pattern.

## Alternatives considered

### Alternative A: PostgreSQL Row-Level Security (RLS) with session variables
- Pro: Database-enforced; impossible to forget at the application layer.
- Pro: Works for any client (Prisma, raw SQL, ad-hoc psql sessions).
- Pro: Auditable — `pg_policies` shows exactly what's enforced.
- Pro: Zero application overhead per query.
- Con: Adds complexity to migrations and tests (must `SET LOCAL` the session variables).
- Con: Background jobs need a service role with RLS bypass; this is intentional but must be documented.

### Alternative B: Application-only authorization (every query filtered by `user_id` in code)
- Pro: Simpler.
- Con: A single forgotten `WHERE user_id = ...` is a tenant breach.
- Con: Hard to audit comprehensively.
- Con: Easily bypassed by ad-hoc queries during incident response.

### Alternative C: Separate database per tenant
- Pro: Maximum isolation.
- Con: Operationally horrible at our scale (thousands of brokers). Migrations would take days.
- Con: Cross-tenant queries (admin reports) become absurdly hard.

### Alternative D: Schema-per-tenant
- Pro: Reasonable isolation.
- Con: Same migration problem as Alternative C.
- Con: No good story for shared resources (properties).

## Decision

Use **PostgreSQL Row-Level Security with session variables** on every user-scoped table. Background jobs use a dedicated service role with RLS bypass, with explicit `WHERE user_id = ...` filters in code.

## Rationale

The cost of a tenant breach is existential. RLS makes the breach require a database privilege escalation, not just an application bug. The complexity tax on tests and migrations is real but bounded — it's a one-time learning cost for the team.

We do not consider Alternative B viable. Brokers' livelihoods are on the line.

## Decision details

### Pattern

Every user-scoped table has RLS enabled. The application sets two session variables at the start of each request transaction:

```sql
SET LOCAL app.current_user_id = '<uuid>';
SET LOCAL app.current_user_role = '<role>';
```

Helper functions read these:

```sql
CREATE FUNCTION current_app_user() RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN current_setting('app.current_user_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'app.current_user_id not set';
END;
$$;

CREATE FUNCTION current_app_role() RETURNS text
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN COALESCE(current_setting('app.current_user_role', true), 'broker');
END;
$$;
```

Standard policy template:

```sql
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings FORCE ROW LEVEL SECURITY;

CREATE POLICY briefings_self_access ON briefings
  FOR ALL
  USING (user_id = current_app_user())
  WITH CHECK (user_id = current_app_user());

CREATE POLICY briefings_admin_access ON briefings
  FOR ALL
  TO postgres  -- the service role
  USING (current_app_role() = 'admin')
  WITH CHECK (current_app_role() = 'admin');
```

### Service role

Background jobs (retention crons, search-svc batch operations) connect as a dedicated service role with `BYPASSRLS`. The role's privileges are limited to the tables it needs. Every query in service-role code includes an explicit `WHERE user_id = ...` filter when applicable, and a code review checklist enforces this.

### Application enforcement

In Node services, the request middleware wraps every request in a transaction:

```typescript
await db.$transaction(async (tx) => {
  await tx.$executeRaw`SET LOCAL app.current_user_id = ${userId}::uuid`;
  await tx.$executeRaw`SET LOCAL app.current_user_role = ${role}`;
  return handler(tx, req);
});
```

In Python services, FastAPI dependency injection sets session variables on the SQLAlchemy session before the handler runs.

### Testing

Every table with RLS has a test that verifies isolation: create two users, write data as user A, attempt to read as user B, assert empty result. This test runs as part of integration tests for every PR that touches the schema.

## Consequences

### Positive
- Tenant isolation is database-enforced.
- Ad-hoc psql sessions during incident response cannot accidentally leak data.
- New tables inherit the pattern via a migration helper.
- Audit-friendly: `\dp` in psql shows the policies.

### Negative
- Tests must arrange session variables. Helper functions reduce boilerplate.
- Background jobs need a separate role with explicit filtering. Code review enforces.
- Some queries become slightly more complex when joining across users (admin reports). These run as the admin role with explicit access logging.

### Neutral
- We accept a small per-query overhead from `SET LOCAL`. Benchmarks show it's < 0.1ms per query.

## When to revisit

- If we move off PostgreSQL (very low probability).
- If we adopt a different multi-tenancy model (database-per-tenant) due to compliance requirements in a new region.
- If RLS performance becomes a measurable bottleneck (would be surprising; PostgreSQL handles this well).

## References

- Sprint 1 ticket AUTH-3
- `docs/security.md`
- https://www.postgresql.org/docs/16/ddl-rowsecurity.html
