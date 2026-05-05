# ADR-0002: Frontend Routing Library — TanStack Router

**Status:** Accepted
**Date:** 2026-05-04
**Author:** Frontend Engineer

## Context

The PropMatch AI web app needs a routing solution. Frontend Sprint 1 (FE-1) requires this decision before scaffolding to avoid rework. The app will have moderate routing complexity: auth flows, dashboard, briefing creation, results, client management, settings, billing — perhaps 30 routes by GA. Some routes load data on entry; some need search params persisted in URL; some need nested layouts.

## Alternatives considered

### Alternative A: TanStack Router
- Pro: Type-safe routes — TypeScript catches invalid path/param/search combinations at compile time.
- Pro: Excellent integration with TanStack Query, which we're already using for server state.
- Pro: First-class search params handling with type validation.
- Pro: Modern, actively maintained, file-based routing supported.
- Con: Newer than React Router; smaller ecosystem of tutorials.
- Con: Some patterns (nested routes with shared loaders) require learning the framework's specific conventions.

### Alternative B: React Router v6
- Pro: De facto standard; every React engineer knows it.
- Pro: Mature, stable, well-documented.
- Pro: Data router (post-v6.4) supports loaders and actions cleanly.
- Con: Type-safety is best-effort; route params come back as `string | undefined` and require manual typing.
- Con: Search param handling is manual; no built-in validation.
- Con: Two different patterns (component routes vs data routes) coexist; team has to settle.

### Alternative C: Next.js App Router
- Pro: File-based routing with server components; potentially powerful.
- Con: We're not building a full Next.js app — we have a Vite SPA hitting separate backend services. Adopting Next.js for routing would mean adopting its server-side runtime, which conflicts with our service-oriented architecture.
- Con: Overkill for our needs; the SPA model is fine.

### Alternative D: Hand-rolled router on top of `history` package
- Pro: Minimal dependency.
- Con: We'd reimplement everything the alternatives provide. No.

## Decision

Use **TanStack Router** with file-based routing.

## Rationale

Type-safe routing is a real productivity win in a TypeScript codebase, especially as the app grows. The team is already learning TanStack Query for server state; TanStack Router is conceptually adjacent and reuses primitives (queries on route entry, search params as state).

The "newer, smaller ecosystem" downside is real but bounded: the docs are good, the API is stable, and we control the abstraction surface in our codebase. We are not betting the company on this choice — if it fails, swapping to React Router v6 would be a 1–2 sprint migration on a pre-Beta codebase.

## Consequences

### Positive
- Compile-time errors for invalid route paths, params, and search params.
- Code completion in route navigation.
- Search params validated through zod schemas, reusable across the codebase.
- Loaders integrate cleanly with TanStack Query for server state.
- File-based routing reduces boilerplate as the app grows.

### Negative
- Engineers familiar with React Router need a brief ramp-up.
- Some patterns (modals as routes, deeply nested layouts) require learning the library's specific conventions.
- Smaller community means fewer Stack Overflow answers; we lean on the official docs.

### Neutral
- File-based routing introduces a `src/routes/` directory convention. New developers learn it once.

## When to revisit

- If TanStack Router is abandoned (low probability — TanStack family is well-maintained).
- If we need server-side rendering for SEO (we don't; this is a broker tool, not a public site).
- If the team grows past 5 frontend engineers and the type safety becomes more friction than help (very unlikely).

## References

- Sprint 1 ticket FE-1
- https://tanstack.com/router
- TanStack Query is decided implicitly via the same family choice.
