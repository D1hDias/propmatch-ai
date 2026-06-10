# Partner Sync Strategies

Reference document for the PropMatch AI partner site sync pipeline.
Last updated: 2026-06-09.

## Strategy Arsenal

All strategies produce the same delta-sync output: add new listings, deactivate removed ones.

| Strategy | Mechanism | Firecrawl credits | Notes |
|---|---|---|---|
| `kenlo_api` | GET `/api/listings?page=N` — JSON paginado (Kenlo/Imobzi platform) | **Zero** | ~100 imóveis/request |
| `sitemidas_api` | POST `/imoveis/resultado` — JSON interno Angular SPA (MidasCRM platform) | **Zero** | 1 chamada retorna tudo |
| `vistahost_api` | API proprietária Vista Software | **Zero** | |
| `karioca_buscar` | GET `/buscar?finality_id=N&page=N` — HTML parseado (plataforma Karioca) | **Zero** | |
| `wp_rest_api:{cpt}` | GET `/wp-json/wp/v2/{cpt}` — JSON estruturado WordPress | **Zero** | Submodos: `direct`, `meta`, `real_homes` (RealHomes plugin) |
| `map_markers` | Parseia variáveis JS lat/lng pré-carregadas na página de listagem | **Zero** | Frágil se o tema muda |
| `sitemap_scrape` | 1 HTTP gratuito no sitemap XML (Yoast/RankMath) → Firecrawl por página **nova** | 1/pág nova | Ideal para WP sem API |
| `wp_url_scrape:{cpt}` | WP REST API descobre URLs (grátis) → Firecrawl por página **nova** | 1/pág nova | Fallback WP sem dados |
| `map_then_scrape` *(fallback)* | Firecrawl MAP para URLs → Firecrawl batchScrape por página **nova** | MAP + 1/pág nova | Universal, mais custoso |

## Tipos de plataforma detectáveis

| Plataforma | Sinal de detecção | Estratégia |
|---|---|---|
| Kenlo / Imobzi | `/api/listings` responde JSON | `kenlo_api` |
| MidasCRM / Sitemidas | POST `/imoveis/resultado` → `{ imoveis: [...] }` | `sitemidas_api` |
| Vista Software / VistaHost | Endpoint Vista | `vistahost_api` |
| Karioca Imóveis | Manual (plataforma única) | `karioca_buscar` |
| WordPress + dados completos | `/wp-json/wp/v2/types` com CPT com price | `wp_rest_api:{cpt}` |
| WordPress + RealHomes plugin | `property_meta.REAL_HOMES_property_price` presente | `wp_rest_api:{cpt}` (modo `real_homes`) |
| WordPress + sem dados estruturados | CPT presente, sem price na API | `wp_url_scrape:{cpt}` |
| Qualquer site com mapa JS | ≥5 pares `"lat":` na HTML da página de listagem | `map_markers` |
| WordPress com sitemap Yoast | `/property-sitemap.xml` acessível | `sitemap_scrape` |
| Qualquer outro | Nenhum dos acima detectado | `map_then_scrape` |

## Ranking custo-benefício

```
TIER 1 — Zero créditos, JSON estruturado (ideal)
─────────────────────────────────────────────────
 1. kenlo_api          JSON paginado perfeito, escala ilimitada
 2. sitemidas_api      POST retorna array completo, 1 chamada
 3. vistahost_api      API proprietária, dados limpos
 4. karioca_buscar     HTTP fetch + parse HTML, confiável
 5. wp_rest_api:{cpt}  REST JSON, zero crédito, escala ilimitada

TIER 2 — Zero créditos, parsing JS (pode quebrar se tema muda)
───────────────────────────────────────────────────────────────
 6. map_markers        JS inline pré-carregado, rápido

TIER 3 — 1 crédito apenas em páginas novas (incremental)
──────────────────────────────────────────────────────────
 7. sitemap_scrape     XML grátis para discovery, Firecrawl só novas
 8. wp_url_scrape:{cpt} WP API grátis para URLs, Firecrawl só novas

TIER 4 — Créditos MAP + créditos por página nova
──────────────────────────────────────────────────
 9. map_then_scrape    Fallback universal
```

## Ordem de auto-detecção (discovery.ts)

Para cada site sem estratégia definida, `discoverPartnerSite()` testa na sequência:

```
1. Sitemidas probe    — 1 HTTP POST  (~200 ms)
2. WP REST API probe  — 2 HTTP GET   (~400 ms)
3. Map markers probe  — até 7 GET    (~1–2 s)
4. → fallback: map_then_scrape
```

Kenlo, VistaHost, Karioca e `sitemap_scrape` requerem identificação manual no painel admin.

## Sync noturno automático

O scheduler (`src/server/partners/sync-queue.ts`) roda a cada hora e enfileira todos os
sites ativos cuja última raspagem foi há mais de `SYNC_INTERVAL_HOURS` horas (padrão: 24).

A janela de execução é **01h–05h BRT** (04h–08h UTC). Fora desta janela o tick é pulado,
garantindo que os syncs recorrentes rodem de madrugada sem impacto no horário comercial.

Sites recém-criados são enfileirados **imediatamente** na criação (bypass da janela horária),
pois o primeiro sync é crítico para popular o inventário.

## Variáveis de ambiente relevantes

| Variável | Padrão | Descrição |
|---|---|---|
| `SYNC_INTERVAL_HOURS` | `24` | Intervalo mínimo entre syncs do mesmo site |
| `SYNC_WINDOW_START_BRT` | `1` | Hora de início da janela noturna (BRT, 0–23) |
| `SYNC_WINDOW_END_BRT` | `5` | Hora de fim da janela noturna (BRT, 0–23) |
