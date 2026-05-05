# API Conventions

Every PropMatch AI service follows these conventions. Inconsistency makes the system harder to learn and harder to debug.

## Versioning

All endpoints are versioned via URL path: `/api/v1/...`. Breaking changes go in a new version. Within a version, fields can be added but not removed or repurposed.

## Authentication

All endpoints require `Authorization: Bearer <JWT>` except:
- `/auth/signup`, `/auth/login`, `/auth/refresh`
- `/lgpd/delete/cancel` (uses a one-time token from the deletion email)
- `/healthz` and `/readyz`

Tokens are JWTs. Access tokens expire in 1 hour, refresh tokens in 30 days. Refresh tokens are rotated on use.

## URL structure

- Resources are plural nouns: `/briefings`, `/clients`, `/properties`.
- Sub-resources are nested when ownership is real: `/briefings/{id}/results`.
- Actions that don't fit REST go as POST to a verb-suffixed path: `POST /briefings/{id}/widen`.
- IDs are UUIDs prefixed by type: `brf_4c1e8f...`, `clt_8f2a...`, `prp_a91...`. Prefixes make logs readable.

## HTTP methods

- `GET` — read, idempotent, no side effects.
- `POST` — create, or invoke an action that has side effects.
- `PATCH` — partial update.
- `PUT` — full replacement (rare; we prefer `PATCH`).
- `DELETE` — remove. Idempotent — deleting an already-deleted resource returns 204, not 404.

## Status codes

| Code | When |
|------|------|
| 200 | Successful read or update returning a body |
| 201 | Successful resource creation; body contains the new resource |
| 202 | Accepted for async processing; body contains a polling URL or job ID |
| 204 | Successful operation with no body to return |
| 400 | Validation error (request shape) |
| 401 | Missing or invalid auth |
| 403 | Authenticated but not authorized; also used for tier-gated features (`FEATURE_GATED`) |
| 404 | Resource does not exist (or RLS hides it — never leak existence) |
| 409 | Conflict (e.g., duplicate email on signup) |
| 422 | Semantic validation error (request shape was valid but business rules rejected it) |
| 429 | Rate limit or concurrency exceeded; includes `Retry-After` header |
| 500 | Server error; logged to Sentry |
| 503 | Service unavailable (dependency down, throttled by spike protection) |

## Request shape

- Content type: `application/json` always.
- Field names: `snake_case` in JSON. Internally TypeScript uses `camelCase`; the boundary converts. Python uses `snake_case` natively.
- Dates: ISO 8601 with timezone, always UTC. Example: `2026-05-04T13:32:00Z`.
- Money: integer cents in the most natural currency (BRL for now). `820000.00` is `82000000` cents.
- Phone: E.164. `+5511987654321`.
- Booleans: actual `true`/`false`. Not `1`/`0`, not `"yes"`/`"no"`.
- Optional fields: omitted, not `null`, unless `null` is a meaningful value (e.g., "explicitly cleared").

## Response envelope

Successful responses do **not** wrap data in an envelope. The response body is the resource or list directly.

```json
{ "id": "brf_4c1e...", "client_id": "clt_8f2a...", ... }
```

Lists return an object with `items` and pagination metadata:

```json
{
  "items": [...],
  "total": 47,
  "page": 1,
  "per_page": 20,
  "next_page_url": "/api/v1/briefings?page=2"
}
```

## Error envelope

Errors **always** use this envelope:

```json
{
  "error": {
    "code": "BRIEFING_EXTRACTION_FAILED",
    "message": "Could not extract minimum criteria from the briefing",
    "user_message": "Não consegui entender o briefing. Pode reformular ou preencher os campos manualmente?",
    "details": { "missing_fields": ["city"] },
    "request_id": "req_a8f2..."
  }
}
```

- `code`: `DOMAIN_REASON` convention. Stable; clients can switch on this.
- `message`: developer-facing English. May change.
- `user_message`: broker-facing Portuguese. May change. Frontends should display this directly.
- `details`: structured context. Optional. Schema varies by `code`.
- `request_id`: correlation ID. Always present. Same as the `X-Request-Id` response header.

## Broker-facing messages (PT-BR)

When a request fails for a reason the broker can act on, `user_message` provides the exact text to display. From PRD §7.4:

| Situation | `user_message` |
|-----------|----------------|
| Source partial failure (1 source) | *"Fonte X temporariamente indisponível. Mostrando resultados parciais ({n} resultados de {total} fontes)."* |
| Multiple sources degraded | *"Estamos com problemas em {n} de {total} fontes agora. Resultados podem estar incompletos. Tente de novo em alguns minutos para uma busca mais completa."* |
| All sources failed | *"Estamos com instabilidade nas fontes agora. Tente novamente em alguns minutos."* |
| HITL overflow → broker edit | *"Não tenho 100% de certeza sobre alguns campos. Confira e ajuste antes de buscar."* |
| Result count = 0 | *"Os critérios são bem específicos e não encontrei nenhum imóvel. Quer ampliar a busca em ±10% no preço ou ±1km de raio?"* |
| Concurrency exceeded (own queue) | *"Você já tem {n} buscas rodando. Aguarde uma terminar para iniciar outra."* |
| Concurrency exceeded (team-shared) | *"A equipe está com {n} buscas rodando agora. Sua busca entra em fila e começa em ~{seconds}s."* |
| Rate limit hit | *"Limite do plano atingido. Tente novamente em {n} minutos ou faça upgrade."* |
| Tier-gated feature | *"Este recurso está disponível no plano {tier} (R$ {price}/mês). Clique para ver os benefícios."* |

Aggregate: never display two stacked error messages from the same operation. Combine into one.

## Common error codes

| Code | Status | Meaning |
|------|--------|---------|
| `INVALID_CREDENTIALS` | 401 | Login failed; same code for unknown email and wrong password to avoid enumeration |
| `TOKEN_EXPIRED` | 401 | JWT expired; client should refresh |
| `TOKEN_INVALID` | 401 | JWT malformed or signature mismatch |
| `INSUFFICIENT_PERMISSIONS` | 403 | Authenticated but cannot access this resource |
| `FEATURE_GATED` | 403 | Tier does not include this feature; `details.required_tier` and `details.upgrade_url` populated |
| `VALIDATION_FAILED` | 400 | Request shape invalid; `details.field_errors` enumerates per-field errors |
| `RESOURCE_NOT_FOUND` | 404 | Resource does not exist or is hidden by RLS |
| `RESOURCE_CONFLICT` | 409 | E.g., duplicate email on signup |
| `BRIEFING_EXTRACTION_FAILED` | 422 | LLM could not extract minimum criteria |
| `BRIEFING_HITL_REQUIRED` | 202 | Briefing routed to HITL queue; `details.estimated_review_time_seconds` populated |
| `RATE_LIMIT_EXCEEDED` | 429 | Tier rate limit hit; `Retry-After` header set |
| `CONCURRENCY_EXCEEDED` | 429 | Per-broker concurrency cap hit; `Retry-After: 30` |
| `SOURCE_UNAVAILABLE` | 503 | One or more sources are down; partial or no results available |

## Idempotency

POST endpoints that create resources accept an `Idempotency-Key` header. Servers cache the response for 24h keyed by `(user_id, idempotency_key)`. Replays return the cached response with header `Idempotent-Replay: true`.

This is mandatory for: briefing creation, message generation, billing operations.

## Pagination

- Cursor pagination preferred for streams (search results).
- Offset/page pagination acceptable for stable lists (clients, briefings history).
- Default page size: 20. Max: 100.

## Rate limiting

Per-tier limits enforced at the gateway. Returns 429 with:
- `Retry-After` header (seconds)
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers

| Capability | Free | Starter | Pro |
|------------|------|---------|-----|
| Briefings/hour | 5 | 60 | 300 |
| Searches/day | 20 | 500 | 5,000 |
| Concurrent searches | 1 | 3 | 10 |
| WhatsApp Cloud API send/day | 0 | 0 | 2,000 |

## WebSockets

Used for streaming search results and briefing status updates. Path: `/ws/v1/briefings/{briefing_id}`. Authentication via JWT in initial query string. Server emits typed events; client handles `result_chunk`, `dedup_complete`, `search_complete`, `error`.

## Health checks

- `GET /healthz` — liveness; returns 200 if process is running. No auth.
- `GET /readyz` — readiness; returns 200 only if all dependencies are reachable. No auth.

Do not put business logic in health checks. They run constantly.

## Logging at the boundary

Every request logs:
- `request_id`, `user_id` (if authenticated), `route`, `method`, `status_code`, `duration_ms`
- `client_ip`, `user_agent` (truncated to 128 chars)
- For 4xx/5xx: `error.code`, `error.message`

PII is **not** logged. Phone numbers, emails, and broker-typed text are hashed or omitted.

## OpenAPI

Each service publishes its OpenAPI 3.1 spec at `/openapi.json`. CI fails if the spec drifts from the implementation. The spec is the contract; documentation generators consume it.

## Backwards compatibility

Within a major version:
- Adding fields to responses: allowed.
- Adding optional request fields: allowed.
- Adding new endpoints: allowed.
- Adding new error codes: allowed.
- Removing or repurposing fields: not allowed.
- Tightening validation: not allowed without a deprecation period.

Breaking changes go in `v2`. We will not have a `v2` for at least the first year.
