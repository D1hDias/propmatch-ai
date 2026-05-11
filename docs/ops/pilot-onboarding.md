# OPS-8 — Pilot Cohort Onboarding Runbook

**Target:** 20 brokers | **Format:** 1:1 setup call (~30min each) | **Sprint:** S7

## Pre-call checklist (per broker)

- [ ] Account created via admin endpoint or signup link
- [ ] Plan set to `starter` via Stripe admin or direct DB update (for pilot)
- [ ] Welcome email sent (Resend template `pilot-welcome`)
- [ ] Broker added to pilot Slack channel `#pilot-brokers`

## Call agenda (30 min)

| Min | Topic |
|-----|-------|
| 0–5 | Intro: o que é o PropMatch AI, como funciona o pilot |
| 5–10 | Live demo: submeter um briefing real do broker |
| 10–20 | Broker experimenta ao vivo (briefing, busca, WhatsApp) |
| 20–25 | Tour de configurações: privacidade, clientes |
| 25–30 | Q&A + feedback inicial, explicar canal de suporte |

## After the call

1. Send follow-up email with link to `docs/dev-setup.md` (user-facing version)
2. Tag broker in BetterStack pilot dashboard
3. Record call outcome in pilot tracking sheet (Notion)
4. If broker hit an error: create Sentry issue, tag `pilot-blocker`

## Pilot success metrics (Week 2 target)

| Metric | Target |
|--------|--------|
| Briefings submitted per broker | ≥ 3 |
| Briefing-to-clipboard time p50 | < 10s |
| NLP accuracy (broker-confirmed) | ≥ 85% |
| Brokers rating UX ≥ 4/5 | ≥ 70% |
| Zero `pilot-blocker` Sentry issues open | ✓ |

## Escalation

- Critical bug (blocks workflow): page on-call via BetterStack, fix within 2h
- UX issue (frustrating but workaroundable): create ticket, fix within 48h
- Feature request: log in backlog, discuss in retro
