# Launch Go/No-Go — PropMatch AI MVP

Checklist operacional para a decisão Go/No-Go do public launch (fim do Sprint 9). Derivado do PRD §10.4 (pilot success criteria) mais critérios operacionais específicos do hosting em VPS.

**Cadência:** revisão diária na semana do launch (W10), com sign-off final 24h antes do go-live.

**Quórum:** Tech Lead + Product + Privacy/Counsel + SRE on-call. Decisão Go requer **todos** os quatro alinhados. Decisão No-Go pode vir de qualquer um dos quatro com justificativa documentada.

## Como usar

Para cada item:
- ✅ **GO** — critério atendido, documentado, validado.
- ⚠️ **HOLD** — critério parcialmente atendido; decisão Go com risco aceito + plano de mitigação.
- ❌ **NO-GO** — critério não atendido; launch adiado até resolução.

Itens marcados **bloqueante** disparam NO-GO automaticamente se ficarem em ❌.

## Seção 1 — Métricas do pilot (PRD §10.4)

Avaliação sobre a janela das últimas 2 semanas do pilot (W8.5–10).

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 1.1 | NPS médio do pilot cohort | ≥ 40 | | medir via formulário pós-pilot |
| 1.2 | Taxa de adoção: % de brokers do pilot que usaram ≥ 3x na semana 2 | ≥ 60% | | |
| 1.3 | NLP accuracy em casos reais do pilot (city, bedrooms, price_max) | ≥ 90% | | benchmark contra fixture revisado |
| 1.4 | Briefing-to-clipboard time p50 | < 6s | | |
| 1.5 | Briefing-to-clipboard time p95 | < 10s | **bloqueante** | |
| 1.6 | Briefing-to-clipboard time p99 | < 15s | | |
| 1.7 | HITL queue p95 review time | < 3 min | **bloqueante** | |
| 1.8 | HITL overflow auto-approve rate | < 15% | | |
| 1.9 | Source success rate (qualquer fonte) | ≥ 95% | **bloqueante** | |
| 1.10 | Dedup precision (manual audit de 50 amostras) | ≥ 95% | | |
| 1.11 | Dedup recall (manual audit de 50 amostras) | ≥ 90% | | |
| 1.12 | Auto-widen acceptance rate quando ofertado | ≥ 50% | | |
| 1.13 | Reportagens de bug críticas no pilot (P0/P1) | 0 nos últimos 7 dias | **bloqueante** | |
| 1.14 | Pilot interview rubric: nenhuma área crítica com avaliação "blocker" | 0 blockers | **bloqueante** | rubric do PRD §10.4 |

## Seção 2 — Sistema e infraestrutura

Avaliação no estado atual da infraestrutura.

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 2.1 | VPS uptime nas últimas 2 semanas | ≥ 99.5% | | |
| 2.2 | RAM peak usage no VPS | < 85% | **bloqueante** | acima disso, OOM iminente |
| 2.3 | CPU peak usage no VPS | < 80% sustained | | |
| 2.4 | Disk usage no VPS | < 70% | | |
| 2.5 | Postgres connection pool peak | < 80% | | |
| 2.6 | Redis memory peak | < 70% | | |
| 2.7 | Backup do Postgres testado restore com sucesso | sim | **bloqueante** | docs/ops/backup-restore.md |
| 2.8 | Caddy + Cloudflare configurados; TLS A+ no SSL Labs | sim | **bloqueante** | |
| 2.9 | Health checks `/healthz` e `/readyz` cobertos por BetterStack | sim | **bloqueante** | |
| 2.10 | Alertas configurados conforme ADR-0008 (5xx rate, latência, downstream) | sim | | |
| 2.11 | Sentry capturando errors em produção; source maps subindo | sim | **bloqueante** | |
| 2.12 | Synthetic load test (3x volume esperado) executado em staging | sim | | last week of W9 |
| 2.13 | Plano de rollback testado em staging | sim | **bloqueante** | revert de release em < 5 min |

## Seção 3 — Conformidade LGPD

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 3.1 | Consent capture obrigatório no signup; checkbox separado | sim | **bloqueante** | |
| 3.2 | Endpoint `POST /api/v1/lgpd/delete` funcionando (auto + manual) | sim | **bloqueante** | |
| 3.3 | Cancellation token email + 7-day grace period implementado | sim | **bloqueante** | |
| 3.4 | Cron jobs de retenção (briefings raw_text 18mo, guests 90d/540d, audit 12mo tokenization) | rodando em produção há ≥ 7 dias | **bloqueante** | |
| 3.5 | Manual deletion runbook revisado e assinado por counsel | sim | **bloqueante** | docs/ops/lgpd-manual-deletion.md |
| 3.6 | DPIA atualizado e assinado por counsel | sim | **bloqueante** | |
| 3.7 | Privacy policy publicada em propmatch.com.br/privacy | sim | **bloqueante** | |
| 3.8 | DPA com processadores (Anthropic, Cloudflare, Resend, Sentry, BetterStack, Stripe) assinados | todos os 6 | **bloqueante** | |
| 3.9 | Página `/settings/privacy` permite solicitar export e delete | sim | | |
| 3.10 | DSAR export endpoint funcional ou processo manual aprovado por counsel para grace period | sim | | |
| 3.11 | Audit log retém 24 meses, tokeniza actor após 12 meses | configurado | **bloqueante** | |
| 3.12 | Procedimento de breach response documentado e treinado | sim | | docs/ops/breach-response.md |

## Seção 4 — Segurança

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 4.1 | Penetration test executado (interno ou contratado) | sim | **bloqueante** | |
| 4.2 | Findings P0/P1 do pentest resolvidos | 0 abertos | **bloqueante** | |
| 4.3 | RLS em todas as tabelas user-scoped; testes de isolamento passando | sim | **bloqueante** | CI |
| 4.4 | Senhas: argon2id com params do ADR; pepper em Secrets Manager | sim | **bloqueante** | |
| 4.5 | JWT signing key rotacionável; procedure documentada | sim | | |
| 4.6 | Secrets nunca em git; pre-commit hook rodando | sim | **bloqueante** | |
| 4.7 | Rate limits em `/auth/signup`, `/auth/login`, `/auth/refresh` ativos | sim | **bloqueante** | |
| 4.8 | Account lockout após 10 falhas em 15min | sim | | |
| 4.9 | Cloudflare WAF com regras básicas (SQLi, XSS, common exploits) | sim | | |
| 4.10 | Dependabot ativo; nenhum CVE high/critical aberto | 0 abertos | **bloqueante** | |
| 4.11 | TLS 1.3 enforced; HSTS preload | sim | | |
| 4.12 | CSP configurado e testado | sim | | |

## Seção 5 — Sources e fornecedores

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 5.1 | Source 1 (partner_a): contrato em vigor, SLA 99% confirmado | sim | **bloqueante** | |
| 5.2 | Source 1 health > 95% nas últimas 2 semanas | sim | **bloqueante** | |
| 5.3 | Source 2 (portal_x): adapter implementado, scraper VPS provisionado | sim | **bloqueante** | |
| 5.4 | Source 2 health > 90% no pilot | sim | | |
| 5.5 | Source 3 (partner_b): LOI assinada, adapter implementado, health-check em produção (flag OFF) | sim | **bloqueante** | PRD §3.4 |
| 5.6 | Source 3 contingency runbook revisado em drill quarterly | sim | | docs/ops/runbook-source-failover.md |
| 5.7 | Anthropic: zero-retention agreement em vigor | sim | **bloqueante** | |
| 5.8 | Anthropic API key budget configurado e monitorado | sim | | |
| 5.9 | Cloudflare R2 buckets com lifecycle policies aplicadas | sim | **bloqueante** | retention LGPD |
| 5.10 | Stripe: produção mode ativada, webhooks endpointados, IP allowlisting opcional configurada | sim | **bloqueante** | |
| 5.11 | Resend: domínio verificado, SPF/DKIM/DMARC configurados | sim | **bloqueante** | |

## Seção 6 — Produto e UX

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 6.1 | Todas as user stories do PRD §6 implementadas | 100% | **bloqueante** | |
| 6.2 | Mensagens broker-facing em PT-BR conforme PRD §7.4 | todas | **bloqueante** | i18n review |
| 6.3 | Acessibilidade: axe-core sem violações em fluxos críticos | sim | | |
| 6.4 | Lighthouse performance score em homepage e dashboard | ≥ 90 | | |
| 6.5 | Mobile responsiveness validada em iOS e Android | sim | | |
| 6.6 | Onboarding tour funcional no primeiro login | sim | | |
| 6.7 | Status page pública em status.propmatch.com.br | sim | | |
| 6.8 | Página de termos de uso publicada | sim | **bloqueante** | |
| 6.9 | FAQ ou help center mínimo (5-10 artigos) publicado | sim | | |
| 6.10 | Email de boas-vindas pós-signup testado em produção | sim | | |

## Seção 7 — Operação e equipe

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 7.1 | On-call rotation definida; incident commander identificado | sim | **bloqueante** | |
| 7.2 | Runbooks atualizados e revisados pelo on-call | sim | | docs/ops/ |
| 7.3 | Pager configurado (BetterStack on-call ou PagerDuty); telefone testado | sim | **bloqueante** | |
| 7.4 | Slack canais `#incidents`, `#engineering`, `#alerts` configurados; alertas roteando | sim | | |
| 7.5 | Documento "primeiros 30 minutos de incidente" rascunhado e revisado | sim | | |
| 7.6 | Time treinado em `runbook-source-failover.md` (drill executado em staging) | sim | | |
| 7.7 | Suporte ao broker: canal definido (email, WhatsApp business?), SLA de resposta | sim | **bloqueante** | |
| 7.8 | Decisão de comunicação em caso de outage: quem fala, em qual canal, em quanto tempo | sim | | |
| 7.9 | Plano de capacity (próximos 90 dias): quando upgrade do VPS ou migração para managed | sim | | |
| 7.10 | Contingência: VPS Hostinger com problema sustentado → plano B (segundo VPS, migração emergency) | sim | | |

## Seção 8 — Legal e comercial

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 8.1 | CNPJ ativo, MEI ou PJ conforme planejado | sim | **bloqueante** | |
| 8.2 | Conta bancária empresarial; conta Stripe ligada | sim | **bloqueante** | |
| 8.3 | Domínio `.com.br` registrado, DNS apontando para Cloudflare | sim | **bloqueante** | |
| 8.4 | Marca "PropMatch" registrada ou em processo no INPI | em processo | | não bloqueia launch |
| 8.5 | Termos de uso revisados por advogado | sim | **bloqueante** | |
| 8.6 | Pricing page publicada (Free/Starter/Pro) | sim | **bloqueante** | |
| 8.7 | Tax handling: Stripe configurado para reter ICMS/ISS conforme aplicável | sim | | |
| 8.8 | Recibo/nota fiscal automatizado ou processo manual definido | sim | **bloqueante** | |
| 8.9 | LGPD-related responses ao ANPD: contato (privacy@) ativo e monitorado | sim | **bloqueante** | |

## Seção 9 — Plano de launch

| # | Critério | Threshold | Status | Notas |
|---|----------|-----------|--------|-------|
| 9.1 | Data e hora do launch confirmadas; mensagem para waitlist agendada | sim | | |
| 9.2 | Plan de rollback definido: como abortar launch nos primeiros 60 min | sim | **bloqueante** | |
| 9.3 | Capacidade do VPS validada para 5x volume esperado nos primeiros 7 dias | sim | | |
| 9.4 | Time de plantão definido para as primeiras 24h pós-launch | sim | **bloqueante** | |
| 9.5 | Métricas de "launch success" definidas: signups primeira semana, briefing volume, NPS pós-7d | sim | | |
| 9.6 | Decisão de "feature freeze": nenhum deploy não-crítico nas 48h antes ou após launch | sim | **bloqueante** | |
| 9.7 | Comunicação interna: time inteiro alinhado em quem faz o quê durante launch | sim | | |

## Decisão final

| Papel | Nome | Decisão | Data/Assinatura |
|-------|------|---------|-----------------|
| Tech Lead | | GO / NO-GO | |
| Product | | GO / NO-GO | |
| Privacy / Counsel | | GO / NO-GO | |
| SRE on-call | | GO / NO-GO | |

**Decisão consolidada:** \_\_\_\_\_\_\_\_\_\_

**Justificativas / riscos aceitos:**

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

**Plano de mitigação para itens em ⚠️ HOLD:**

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

## Pós-launch — checklist do dia D+1, D+7, D+30

### D+1 (24h após launch)
- [ ] Revisar Sentry: novos errors triados, P0/P1 fechados.
- [ ] Revisar BetterStack: uptime, latência, alertas disparados.
- [ ] Revisar métricas de produto: signups, briefings, conversões free→paid.
- [ ] Suporte: tickets respondidos no SLA?
- [ ] Ajustes emergenciais documentados como tickets para próxima sprint.

### D+7 (1 semana)
- [ ] Pilot success criteria reavaliado em escala maior — métricas mantêm-se.
- [ ] Capacity review: VPS está saudável com volume real?
- [ ] LGPD: chegou alguma solicitação de DSAR? processo funcionou?
- [ ] Retro de launch com time inteiro.

### D+30 (1 mês)
- [ ] Post-mortem público de launch (lessons learned).
- [ ] Plano de capacity validado: quando precisamos do upgrade?
- [ ] Beta phase officially opened: novos brokers fora da fila inicial.
- [ ] Roadmap pós-MVP atualizado.

## Aprovações

Este checklist foi revisado e aprovado por:

- [ ] Tech Lead — data
- [ ] Product Manager — data
- [ ] Privacy/Counsel — data (sign-off mandatório pré-launch)
- [ ] SRE Lead — data

Atualizações neste checklist requerem nova revisão.
