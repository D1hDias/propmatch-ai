# PropMatch AI

Intelligent property matching and WhatsApp distribution for real estate brokers.

PropMatch AI takes a free-form client briefing — the kind of message a broker receives on WhatsApp every day — and turns it into a curated, send-ready list of matching properties in under 10 seconds.

## What it does

A broker pastes a client message:

> *"Casal procurando 2 quartos na Vila Mariana, perto de metrô, até 850k, aceita reformar."*

PropMatch AI:

1. Extracts structured criteria using an LLM (city, neighborhood, bedrooms, price, must-haves).
2. Queries multiple sources in parallel — partner APIs first, scraped portals as fallback.
3. Deduplicates listings using address normalization and geohash matching.
4. Ranks by fit score and returns a curated grid.
5. The broker selects the best matches and clicks "Generate WhatsApp."
6. A formatted message — with photos, prices, neighborhoods, and short links — is copied to the clipboard, ready to send.

End-to-end: under 10 seconds. Replaces a workflow that takes brokers 90–120 minutes today.

## Status

Pre-MVP. Sprint 1 is foundations: monorepo, CI/CD, auth, design system. MVP launches Week 10.

See [docs/prd.md](docs/prd.md) for the full Product Requirements Document.

## Documentation

- [docs/prd.md](docs/prd.md) — Product Requirements Document v1.4
- [docs/architecture.md](docs/architecture.md) — System architecture
- [docs/dev-setup.md](docs/dev-setup.md) — Local development bootstrap
- [docs/api-conventions.md](docs/api-conventions.md) — API design rules
- [docs/data-model.md](docs/data-model.md) — Database schema reference
- [docs/testing.md](docs/testing.md) — Test strategy
- [docs/security.md](docs/security.md) — Auth, RLS, secrets
- [docs/lgpd-compliance.md](docs/lgpd-compliance.md) — LGPD policies
- [docs/glossary.md](docs/glossary.md) — Domain vocabulary
- [docs/adr/](docs/adr/) — Architecture Decision Records
- [docs/ops/](docs/ops/) — Runbooks and manual procedures
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute
- [CLAUDE.md](CLAUDE.md) — Operating manual for AI assistants in this repo

## Quick start

```bash
git clone git@github.com:propmatch/propmatch-ai.git
cd propmatch-ai
pnpm install && pnpm bootstrap
pnpm dev
```

Full instructions: [docs/dev-setup.md](docs/dev-setup.md).

## Tech stack at a glance

- **Frontend:** React 18, TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query, TanStack Router
- **Backend:** Node.js (auth, messaging) + Python (briefing extraction, search/dedup)
- **Data:** PostgreSQL 16, Redis 7, OpenSearch, S3
- **AI:** Anthropic Claude API for briefing extraction
- **Infra:** Railway (MVP) → AWS ECS Fargate (post-Beta)

## License

Proprietary. All rights reserved.

## Contact

Engineering: engineering@propmatch.ai
Product: product@propmatch.ai
