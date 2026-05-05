# Contributing to PropMatch AI

This is the contribution playbook for engineers working on this codebase. It is also the contract Claude Code follows.

## Workflow

1. Pick a ticket from the active sprint board.
2. Create a branch from `main`: `{type}/{ticket-id}-{slug}`.
   - Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.
   - Examples: `feat/AUTH-2-jwt-signup-login`, `fix/SEARCH-14-dedup-edge-case`.
3. Write the test first if the logic is non-trivial.
4. Implement.
5. Update relevant documentation (per-service CLAUDE.md, README.md, docs/).
6. Open a PR linking the ticket. PR title uses Conventional Commits.
7. CI must pass. At least one approval required. Code owners enforced via `CODEOWNERS`.
8. Squash and merge.

## Commit messages

Conventional Commits, no exceptions:

```
feat(auth): add refresh token rotation

Closes AUTH-2.
```

- Type: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `build`, `ci`.
- Scope: the service or area: `auth`, `briefing`, `search`, `messaging`, `web`, `infra`, `docs`.
- Subject: imperative mood, lowercase, no trailing period, ≤ 72 chars.
- Body: explain *why*, not *what*. The diff shows what.

## Pull requests

- One ticket per PR. If a ticket needs to ship in multiple PRs, link them in the description.
- PR description template:
  - **What changed and why** (3–5 sentences)
  - **Linked ticket** (e.g., AUTH-2)
  - **How to test** (manual steps if relevant)
  - **Risk** (low / medium / high — explain if medium or high)
  - **Screenshots/recordings** for UI changes
- PRs that change API contracts must update `packages/shared-types` and `docs/api-conventions.md`.
- PRs that change the schema must update `docs/data-model.md` and include reversible migrations.

## Code review expectations

Reviewers look for:

1. Correctness — does it do what the ticket says?
2. Tests — would this catch a regression?
3. Hard rules in [CLAUDE.md](CLAUDE.md) — is anything violated?
4. Naming and clarity — would a new engineer understand this in 6 months?
5. Performance — any obvious O(n²) traps or unbatched I/O?
6. Security — any path where user input reaches a query or shell?

Reviewers do **not** litigate style. ESLint, Prettier, ruff, and mypy decide style.

## Definition of done

A ticket is done only when all of the following are true. No exceptions.

- [ ] Code merged to `main` via PR with at least one approval.
- [ ] All AC items in the ticket are demonstrably met.
- [ ] Unit tests cover new logic; coverage ≥ 70% on changed files.
- [ ] If the change touches a user-visible flow, an E2E Playwright test exists.
- [ ] Sentry/Datadog instrumentation in place for new code paths.
- [ ] No new lint or type warnings.
- [ ] Documentation updated (per-service CLAUDE.md, README.md, or docs/).
- [ ] If API contract changed: `docs/api-conventions.md` and `packages/shared-types` updated.
- [ ] If schema changed: `docs/data-model.md` updated.
- [ ] If a decision was made: ADR filed in `docs/adr/`.

## Architecture Decision Records

Any non-trivial decision (library choice, pattern, tradeoff) must be captured as an ADR. See `docs/adr/0000-template.md` for the format.

ADRs are immutable once accepted. To change a decision, write a new ADR that supersedes the old one.

## Testing

- Unit tests live next to the code they test.
- Integration tests live in `tests/integration/` per service.
- E2E tests live in `apps/web/e2e/`.
- See [docs/testing.md](docs/testing.md) for the full strategy.

## Branching and releases

- `main` is always deployable to staging.
- Production deploys are manual, gated by approval, tagged with semver.
- Hotfixes branch from the latest production tag, merge to `main` and to the production branch.

## Security

- Never commit secrets. Pre-commit hook scans for patterns; treat false negatives as your responsibility.
- Report vulnerabilities privately to security@propmatch.ai. Do not file public tickets.
- LGPD compliance is a hard rule. See [docs/lgpd-compliance.md](docs/lgpd-compliance.md) and [docs/security.md](docs/security.md).

## Questions

- Stuck on a ticket? Ask in `#engineering` on Slack.
- Disagree with a decision? File a counter-ADR.
- Found a process gap? Open a docs PR.

## License

By contributing you agree your contributions are licensed under the project's proprietary license.
