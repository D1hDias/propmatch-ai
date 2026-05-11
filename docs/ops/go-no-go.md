# Go/No-Go Checklist — Lançamento Público PropMatch AI

> Responsável: CTO + fundadores  
> Executar na véspera do lançamento. Todos os itens **PASS** são obrigatórios. Um único **FAIL** bloqueia o lançamento.

---

## 1. Infraestrutura

| # | Verificação | Critério | Status |
|---|-------------|----------|--------|
| 1.1 | VPS principal responde | `curl https://propmatch.com.br/api/v1/health` → 200 em <500ms | ☐ PASS ☐ FAIL |
| 1.2 | VPS scraper responde | `curl http://scraper-vps:3100/health` → 200 | ☐ PASS ☐ FAIL |
| 1.3 | Postgres replica em dia | Lag < 30s — verificar BetterStack | ☐ PASS ☐ FAIL |
| 1.4 | Redis disponível | `redis-cli ping` → PONG | ☐ PASS ☐ FAIL |
| 1.5 | Backup recente | Backup concluído nas últimas 24h — ver pgBackRest logs | ☐ PASS ☐ FAIL |
| 1.6 | Caddy TLS válido | Certificado expira em > 30 dias | ☐ PASS ☐ FAIL |
| 1.7 | Cloudflare ativo | DNS aponta para Cloudflare, WAF ativo | ☐ PASS ☐ FAIL |

## 2. Aplicação

| # | Verificação | Critério | Status |
|---|-------------|----------|--------|
| 2.1 | Build sem erros TS | `pnpm typecheck` → 0 erros | ☐ PASS ☐ FAIL |
| 2.2 | Suite de testes passa | `pnpm test` → ≥ 95% passing | ☐ PASS ☐ FAIL |
| 2.3 | E2E críticos passam | Playwright: login, briefing, search, clipboard | ☐ PASS ☐ FAIL |
| 2.4 | Load test aprovado | k6 pilot-load.js: p95 < 3s, errors < 1% sob 50 VUs | ☐ PASS ☐ FAIL |
| 2.5 | Sem erros no Sentry nas últimas 24h | Sentry: zero erros novos não tratados | ☐ PASS ☐ FAIL |
| 2.6 | Variáveis de ambiente completas | Checar `.env.production.vault` — todos os required preenchidos | ☐ PASS ☐ FAIL |
| 2.7 | Feature flags corretas | `FEATURE_SOURCE_PARTNER_B=false`, `SOURCE_MOCK=false` | ☐ PASS ☐ FAIL |

## 3. Segurança

| # | Verificação | Critério | Status |
|---|-------------|----------|--------|
| 3.1 | RLS ativa | Consultar `docs/security.md` — drill executado | ☐ PASS ☐ FAIL |
| 3.2 | Rate limiting ativo | Middleware bloqueia > 10 req/min em plano Free | ☐ PASS ☐ FAIL |
| 3.3 | Headers de segurança | `curl -I https://propmatch.com.br` → X-Content-Type, CSP, HSTS presentes | ☐ PASS ☐ FAIL |
| 3.4 | Nenhuma chave exposta no git | `git log --all -- '*.env*'` → vazio | ☐ PASS ☐ FAIL |
| 3.5 | LGPD consent funcional | Fluxo de cadastro pede e salva consentimento | ☐ PASS ☐ FAIL |

## 4. Fontes de dados

| # | Verificação | Critério | Status |
|---|-------------|----------|--------|
| 4.1 | ZAP retorna resultados | Busca de teste em SP → ≥ 5 imóveis | ☐ PASS ☐ FAIL |
| 4.2 | Viva Real retorna resultados | Busca de teste em SP → ≥ 5 imóveis | ☐ PASS ☐ FAIL |
| 4.3 | Health monitor operacional | `GET /api/v1/search/health` → todos os sources com `healthy: true` | ☐ PASS ☐ FAIL |
| 4.4 | Dedup funcionando | Mesma busca duplicada → sem duplicatas no resultado | ☐ PASS ☐ FAIL |

## 5. Produto

| # | Verificação | Critério | Status |
|---|-------------|----------|--------|
| 5.1 | Fluxo completo end-to-end | Briefing → resultados → clipboard em < 10s | ☐ PASS ☐ FAIL |
| 5.2 | Onboarding tour funcional | Modal aparece para novo usuário | ☐ PASS ☐ FAIL |
| 5.3 | Billing funcional | Checkout Stripe cria sessão, webhook atualiza plano | ☐ PASS ☐ FAIL |
| 5.4 | Export LGPD funcional | Usuário dispara export, job entra na fila | ☐ PASS ☐ FAIL |
| 5.5 | Landing page publicada | `https://propmatch.com.br` carrega sem erros | ☐ PASS ☐ FAIL |

## 6. Negócio / Legal

| # | Verificação | Critério | Status |
|---|-------------|----------|--------|
| 6.1 | Termos de uso publicados | Link visível no footer e no cadastro | ☐ PASS ☐ FAIL |
| 6.2 | Política de privacidade publicada | Link visível, conforme LGPD | ☐ PASS ☐ FAIL |
| 6.3 | Status page ativa | BetterStack status page pública acessível | ☐ PASS ☐ FAIL |
| 6.4 | Canal de suporte operacional | Email / WhatsApp de suporte responde | ☐ PASS ☐ FAIL |

---

## Resultado

| Aprovação | Responsável | Assinatura | Data/Hora |
|-----------|-------------|------------|-----------|
| Técnica | CTO | | |
| Produto | CPO | | |
| Negócio | CEO | | |

**Decisão final**: ☐ GO &nbsp;&nbsp; ☐ NO-GO

Se NO-GO, documentar o(s) bloqueador(es) e a nova data alvo:

```
Bloqueador(es):
Nova data alvo:
```
