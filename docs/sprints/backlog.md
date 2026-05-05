# Backlog — Sprints 2 a 10

Backlog completo do MVP. **Sprint 1 já foi entregue separadamente** (`docs/sprints/sprint-1.md`); este documento cobre S2 a S10.

Cada sprint tem **capacidade alvo de 38 pontos** (~5 dias úteis × 4 devs × ~2 pts/dia, com ~10% de folga). Tickets seguem a convenção `{ÁREA}-{N}` consistente entre sprints. Tickets críticos têm AC detalhada; os demais têm AC sumarizada (a expansão acontece no momento do refinement).

## Convenções

- **Áreas:** `INFRA` (devops), `AUTH` (auth/LGPD), `BRF` (briefings), `SRC` (search/sources), `MSG` (messaging), `FE` (frontend específico, quando não for parte de outra área), `DATA` (schema/migrations), `QA` (testes), `OPS` (runbooks).
- **Pontos:** 1 (trivial), 2 (típico), 3 (com risco), 5 (épico que precisa quebrar).
- **Risco:** A (alto — precisa spike), M (médio — refinement caprichado), B (baixo — implementação direta).

## Sprint 2 — Briefing Intake + LLM Extraction (W3-4)

**Objetivo:** Broker autenticado consegue submeter briefing free-form e ver os critérios extraídos. Sem busca ainda.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| DATA-1 | Schema: tabelas `briefings`, `hitl_metrics` (sem constraint `client_id` ainda) | 2 | B | S1 |
| BRF-1 | Outbound HTTP wrapper para Anthropic API (timeout, retry, circuit breaker) | 3 | M | DATA-1 |
| BRF-2 | Service `extractBriefing()`: prompt + zod schema + confidence scoring | 5 | A | BRF-1 |
| BRF-3 | Route `POST /api/v1/briefings`: validação, persist, dispatch para extract | 3 | M | BRF-2 |
| BRF-4 | Route `GET /api/v1/briefings/{id}`: SSR + RLS check | 2 | B | BRF-3 |
| FE-3 | Página `/briefings/new`: textarea + counter + submit (PT-BR) | 3 | B | BRF-3 |
| FE-4 | Página `/briefings/{id}`: render extracted criteria + "ainda processando" | 3 | M | BRF-4 |
| AUTH-5 | OAuth Google (signup + login) | 5 | M | S1 |
| QA-2 | Fixture set inicial: 50 briefings PT-BR rotulados | 3 | B | BRF-2 |
| QA-3 | NLP accuracy benchmark rodando em CI noturno | 3 | M | QA-2 |
| OPS-1 | Cron de retenção de `raw_text` (18 meses) | 3 | M | DATA-1 |
| INFRA-4 | Sentry + BetterStack alertando para production | 2 | B | S1 |

**Total:** 37 pts. **Demo de sprint:** broker faz signup, submete briefing, vê extração + confidence score na tela. Sem busca.

**AC-chave do épico (BRF-2):**
- LLM responde JSON estruturado conforme zod schema; respostas malformadas viram erro `BRIEFING_EXTRACTION_FAILED`.
- Confidence score >= 0.85 marca `review_status='not_required'`.
- Confidence score 0.80-0.85 marca `review_status='auto_approved_with_override'`.
- Confidence score < 0.80 OU campo crítico ausente (city, bedrooms, price_max) → `review_status='pending'` (HITL ainda não implementado; só registra estado).
- p95 da latência do extract < 1.5s (Anthropic API costuma rodar 200-400ms).
- Prompt explicitamente instrui a IA a tratar conteúdo do usuário como dado, não instrução (mitigação básica de prompt injection).

## Sprint 3 — Sources, SourceAdapter, Source 1 ao vivo (W5)

**Objetivo:** SourceAdapter implementado. Source 1 (parceiro com API) entregando resultados reais. Sem dedup ainda.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| DATA-2 | Schema: tabelas `properties`, `property_sources` + índices | 3 | M | S2 |
| SRC-1 | Interface `SourceAdapter` + `NormalizedListing` (Node TypeScript port do ADR-0006) | 3 | M | DATA-2 |
| SRC-2 | Adapter `partner_a` (Source 1) — implementação completa | 5 | A | SRC-1 |
| SRC-3 | Health monitor: poll cada 60s, marca status, log estruturado | 3 | M | SRC-1 |
| SRC-4 | Service `runSearch()`: fan-out parallel, timeout 5s por source, agrega resultados | 3 | M | SRC-2 |
| SRC-5 | Route `POST /api/v1/briefings/{id}/search`: dispara busca, retorna job id | 2 | B | SRC-4 |
| SRC-6 | Route `GET /api/v1/briefings/{id}/stream`: SSE com `result_chunk`, `search_complete` | 5 | A | SRC-5 |
| FE-5 | Página `/briefings/{id}` consome SSE, renderiza grid em tempo real | 5 | M | SRC-6 |
| FE-6 | Componente `PropertyCard` (preço BR, fotos via CF R2, fit_score) | 3 | B | FE-5 |
| OPS-2 | Setup do scraper VPS separado (provisionamento e firewall, sem código de scraping ainda) | 2 | M | nenhuma |
| QA-4 | Mock adapter para testes; integração ponta-a-ponta de busca | 3 | M | SRC-4 |

**Total:** 37 pts. **Demo:** broker submete briefing → vê grid de resultados reais do parceiro 1, em streaming.

**AC-chave do épico (SRC-6 / SSE):**
- Conexão SSE persiste por até 60s ou até `search_complete`.
- Reconexão com `Last-Event-Id` retoma sem replicar chunks.
- Cap de SSE concorrente por broker (Free 1, Starter 3, Pro 10) — herda do concurrency cap.
- Cloudflare config ajustada para não fazer buffer de SSE (`no-transform`, `Cache-Control: no-cache`).

## Sprint 4 — Dedup, Ranking, Auto-widen (W6)

**Objetivo:** Resultados deduplicados e ranqueados. Auto-widen funciona quando resultados < 5.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| SRC-7 | Função `normalizeAddress()` (lowercase, accent strip, abreviações) | 3 | M | S3 |
| SRC-8 | Função `geohash7()` + bucketing | 2 | B | S3 |
| SRC-9 | Algoritmo de dedup: address + geohash + bedrooms; 50ms p95 budget | 5 | A | SRC-7, SRC-8 |
| SRC-10 | Função `fitScore()`: 0-100 baseada em match de critérios | 3 | M | SRC-9 |
| SRC-11 | Auto-widen: se resultados < 5, propor ±10% preço, +1km raio, bairros adjacentes | 5 | A | SRC-10 |
| DATA-3 | Schema: tabela `briefing_results` (PK composta, fit_score, selected, personal_note) | 2 | B | S3 |
| FE-7 | UI de auto-widen offer com mensagem PT-BR | 3 | M | SRC-11 |
| FE-8 | Filtros e ordenação no grid (preço, área, fit) | 3 | B | S3 |
| QA-5 | Suite de testes para dedup com 200 properties fixture | 3 | M | SRC-9 |
| BRF-5 | Implementar HITL queue real (BullMQ): enqueue + dequeue + worker | 5 | A | S2 |

**Total:** 34 pts (folga para imprevistos do dedup). **Demo:** briefing com critérios estreitos → 0 resultados → auto-widen oferecido → broker aceita → grid se popula.

## Sprint 5 — Clients, client_id NOT NULL, LGPD progressivo (W7)

**Objetivo:** Sistema de clientes (salvos e guest). Constraint `briefings.client_id NOT NULL` ativada. Cron jobs de retenção LGPD ligados.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| DATA-4 | Schema: tabela `clients` + state machine `archive_status` | 3 | M | S2 |
| DATA-5 | Migration: backfill `briefings.client_id` para guests; aplicar NOT NULL | 5 | A | DATA-4 |
| AUTH-6 | Endpoint LGPD: `POST /api/v1/lgpd/delete` (já em S1 base; agora completar fluxo de cancellation_token) | 2 | B | S1 |
| FE-9 | UI de seleção de cliente no `/briefings/new` (saved + "guest") | 3 | M | DATA-4 |
| FE-10 | Página `/clients` com listagem + arquivamento/restauração | 5 | M | DATA-4 |
| FE-11 | Componente `GuestArchiveBanner` (d30 lembrete, d60 modal) | 3 | M | DATA-4 |
| OPS-3 | Cron job: soft-archive de clients guest dia 90 com briefings | 3 | M | DATA-4 |
| OPS-4 | Cron job: hard-delete de clients guest dia 90 sem briefings | 2 | M | DATA-4 |
| OPS-5 | Cron job: hard-delete de clients soft-archived dia 540 | 2 | M | OPS-3 |
| OPS-6 | Job: tokenização de actor_user_id em audit_log após 12 meses | 3 | M | nenhuma |
| QA-6 | E2E: criar guest → submeter briefing → próximo dia ainda existe → dia 91 soft-archived | 3 | A | OPS-3 |

**Total:** 34 pts. **Demo:** broker submete briefings sem selecionar cliente, sistema cria guests automaticamente; broker pode salvar como cliente real depois.

**AC-chave do épico (DATA-5):**
- Migration backfill é idempotente e rodável em produção sem downtime.
- Para cada briefing existente sem `client_id`, criamos um guest client e linkamos.
- Após backfill, ALTER TABLE adiciona constraint NOT NULL.
- Rollback documentado: drop constraint, drop guests órfãos. Reversibilidade testada em CI.

## Sprint 6 — Messaging (clipboard) + tier gating (W8)

**Objetivo:** Broker seleciona resultados e copia mensagem WhatsApp para clipboard. Tier gating ativo.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| DATA-6 | Schema: tabela `messages` | 2 | B | S5 |
| MSG-1 | Service `formatWhatsAppMessage()`: template com fotos, preço, links curtos | 5 | A | DATA-6 |
| MSG-2 | Route `POST /api/v1/briefings/{id}/messages`: cria message, retorna formatted_text | 3 | M | MSG-1 |
| MSG-3 | Encurtador de URL próprio (path no domínio, redirect 301 com tracking) | 3 | M | nenhuma |
| FE-12 | Modo de seleção no grid (multiselect com drawer agregando seleção) | 3 | M | S4 |
| FE-13 | Modal "Gerar WhatsApp": personalização de nota por imóvel, preview da mensagem | 5 | M | FE-12 |
| FE-14 | Cópia para clipboard com confirmação visual + fallback para `execCommand` | 2 | M | FE-13 |
| AUTH-7 | Tier gating middleware: lê `users.plan`, retorna 403 `FEATURE_GATED` quando feature não inclusa | 3 | M | S1 |
| FE-15 | Modal de upgrade ao bater feature gate; CTA para billing | 3 | B | AUTH-7 |
| QA-7 | E2E: free user tenta feature pro → vê modal upgrade | 2 | B | AUTH-7 |
| OPS-7 | Hash do telefone do destinatário em messages após 90 dias | 2 | M | DATA-6 |

**Total:** 33 pts. **Demo:** workflow completo end-to-end — briefing → grid → seleção → mensagem WhatsApp na área de transferência. Free user testa upgrade flow.

## Sprint 7 — LGPD export, billing, polimento pré-pilot (W9)

**Objetivo:** DSAR export pronto. Stripe integrado. Pilot cohort recrutado e onboarded.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| AUTH-8 | Endpoint `POST /api/v1/lgpd/export`: cria job, worker async monta ZIP, sobe para R2 | 5 | A | S1 |
| AUTH-9 | Email com link signed (72h TTL) via Resend | 2 | B | AUTH-8 |
| FE-16 | Página `/settings/privacy`: solicitar export, ver status, baixar | 3 | M | AUTH-8 |
| BILL-1 | Integração Stripe Checkout para upgrade | 3 | M | nenhuma |
| BILL-2 | Webhook handler: atualiza `users.plan` em sucessos, downgrade em failed payment | 5 | A | BILL-1 |
| BILL-3 | Página `/settings/billing`: plano atual, próxima cobrança, downgrade | 3 | M | BILL-2 |
| OPS-8 | Runbook: pilot cohort onboarding (20 brokers, 1:1 setup call) | 2 | B | nenhuma |
| OPS-9 | Dashboard de pilot metrics em BetterStack (briefing-to-clipboard, NLP accuracy, fontes) | 3 | M | INFRA-4 |
| QA-8 | E2E: solicitar export → recebe email com link → ZIP completo e válido | 3 | M | AUTH-9 |
| FE-17 | Onboarding: tour interativo de 4 passos no primeiro login | 5 | M | nenhuma |
| QA-9 | Synthetic load injection: 150 briefings/h via k6 contra produção pré-pilot | 3 | A | nenhuma |

**Total:** 37 pts. **Demo:** ciclo completo de billing (upgrade + downgrade); export LGPD funcional; 20 brokers do pilot operando.

## Sprint 8 — Observação do pilot, ajustes, hardening (W9.5-10)

**Objetivo:** Sprint reativa baseada no feedback do pilot. Tickets pré-alocados são placeholders.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| PILOT-1 | Triagem semanal de feedback do pilot (3 sessões 1:1) | 3 | B | S7 |
| PILOT-2 | Implementação dos 3 ajustes mais críticos do feedback (placeholder; concrete tickets nascem aqui) | 8 | A | PILOT-1 |
| PILOT-3 | NLP accuracy: ajuste fino do prompt baseado em casos reais | 5 | A | PILOT-1 |
| INFRA-5 | Tuning Postgres: índices baseados em query patterns reais; vacuum schedule | 3 | M | observação real |
| INFRA-6 | Tuning Caddy/Cloudflare cache headers: estáticos, fotos, assets | 2 | B | nenhuma |
| QA-10 | Caos engineering: matar serviço Postgres em staging, validar comportamento | 3 | M | nenhuma |
| OPS-10 | Drill: testar runbook de Source failover em staging | 2 | B | nenhuma |
| OPS-11 | LGPD manual deletion dry-run com counsel | 3 | A | S5 |
| FE-18 | Polimento UI: micro-animações, estados vazios, feedback de erro | 5 | B | nenhuma |
| OPS-12 | Backup automation: pgBackRest para R2; teste de restore | 3 | M | nenhuma |

**Total:** 37 pts. **Demo:** issues do pilot resolvidas; sistema endurecido para launch público.

## Sprint 9 — Public launch prep + Source 2 (W10)

**Objetivo:** Source 2 ao vivo (scraping). Public launch executado.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| SRC-12 | Adapter `portal_x` (Source 2) — Playwright + proxy pool, no scraper VPS | 8 | A | OPS-2 |
| SRC-13 | Coordenação main app ↔ scraper VPS via API autenticada | 3 | M | SRC-12 |
| SRC-14 | Deploy do scraper VPS via systemd, com health checks | 3 | M | SRC-12 |
| SRC-15 | Source 3 (`partner_b`): adapter implementado e health-checking em produção (flag OFF) | 5 | A | SRC-1 |
| OPS-13 | Confirmação Source 3 LOI assinada + contrato em vigor | 0 | A | comercial |
| OPS-14 | Final do Go/No-Go checklist; sign-off de todos | 3 | M | tudo |
| OPS-15 | Status page pública (https://status.propmatch.com.br) via BetterStack | 2 | B | nenhuma |
| MKT-1 | Landing page pública pré-launch (separada do app) | 5 | M | nenhuma |
| MKT-2 | Email de launch para waitlist | 1 | B | MKT-1 |
| INFRA-7 | Plano de rollback documentado e testado em staging | 3 | M | nenhuma |

**Total:** 33 pts. **Demo:** launch público; brokers fora do pilot conseguem signup pela landing.

**AC-chave do épico (SRC-12):**
- Scraper VPS roda Playwright em containers; proxy rotation via residential pool.
- Rate limit local respeitado; nunca mais que 5 req/s contra portal_x.
- Health check do adapter retorna OK se 95%+ das últimas 100 requisições foram bem-sucedidas.
- Alerta dispara se health < 80% por 1h.
- Cease-and-desist do portal: feature flag desativa Source 2; runbook de failover disponível (`docs/ops/runbook-source-failover.md`).

## Sprint 10 — Estabilização pós-launch (W11)

**Objetivo:** Operação estável. Bugs do launch corrigidos. Métricas de pilot success bate.

| ID | Título | Pts | Risco | Dependências |
|----|--------|-----|-------|--------------|
| BUG-* | Triagem e fix de bugs do launch público | 15 | A | observação |
| OPS-16 | Post-mortem do launch + ADRs para mudanças sistemáticas | 3 | M | observação |
| OPS-17 | Decommission do processo manual de LGPD deletion (após 14 dias clean) | 2 | B | OPS-11 |
| INFRA-8 | Análise de capacity: VPS está em 30%? 50%? 70%? plan de upgrade | 2 | B | observação |
| QA-11 | Stress test pós-launch: 3x volume real | 3 | M | observação |
| MSG-4 | Spike: integração WhatsApp Cloud API (Phase 2 prep) | 5 | A | nenhuma |
| FE-19 | Dashboard analytics para o broker (briefings por mês, top neighborhoods) | 5 | M | nenhuma |
| OPS-18 | Documentar lessons learned; atualizar PRD para v1.5 se necessário | 3 | B | observação |

**Total:** 38 pts. **Demo:** sistema estável; pilot success criteria batidos; roadmap pós-MVP definido.

## Resumo do MVP

| Sprint | Tema | Pts | Demo |
|--------|------|-----|------|
| S1 | Foundations | 39 | Signup + login |
| S2 | Briefing intake + LLM | 37 | Submeter briefing, ver extração |
| S3 | Sources + SourceAdapter + Source 1 | 37 | Resultados reais streamando |
| S4 | Dedup + ranking + auto-widen | 34 | Auto-widen funcional |
| S5 | Clients + LGPD progressivo | 34 | Guests + cron retenção |
| S6 | Messaging + tier gating | 33 | Workflow end-to-end |
| S7 | LGPD export + billing + pilot prep | 37 | Pilot 20 brokers ao vivo |
| S8 | Pilot ajustes + hardening | 37 | Sistema endurecido |
| S9 | Source 2 + public launch | 33 | Launch público |
| S10 | Estabilização | 38 | MVP entregue, stable |

**Total:** 359 pts em 10 sprints. **Capacidade alvo:** 380 pts (10 × 38). Folga embutida: ~5%.

## Tickets globais (não-sprint, contínuos)

Estes não são pontuados num sprint específico mas são responsabilidades contínuas:

- Triagem de Sentry todo dia.
- Daily standup (15min) revisando bloqueios.
- Code review SLA: 1 dia útil.
- Atualização de docs em PRs que mexem em contratos.
- Triagem semanal de issues abertas.
- Reunião quinzenal de retro.

## Ajustes pós-stack-pivot

Para o ticket pack do **Sprint 1 já entregue**, dois ajustes pequenos:

- **INFRA-1 (monorepo):** ajustar para "Next.js single repo" em vez de "monorepo com pnpm workspaces". Workspaces continuam úteis se um dia separarmos `packages/shared-types`, mas no MVP é overkill — uma única `package.json` na raiz.
- **INFRA-3 (cloud + observability):** trocar Datadog por Sentry + BetterStack conforme ADR-0008. Trocar AWS Secrets Manager por dotenv-vault + systemd EnvironmentFile conforme ADR-0009. Provisioning do VPS Hostinger entra aqui.
- **AUTH-3 (RLS pattern):** continua válido sem mudanças.
- **FE-1 / FE-2:** trocar "Vite + TanStack Router" por "Next.js 15 App Router". Mesmo escopo de signup/login UI.

Estes ajustes são pequenos o suficiente para atualizar in-place no documento do Sprint 1; não justificam um novo doc.
