# Backlog: Firecrawl Actions para scroll e interação

**Status**: Em standby — implementar após estabilizar extração por markdown (v pós-13/05/2026)

## Problema

Sites imobiliários com infinite scroll ou botão "Ver mais" renderizam apenas 6–10 imóveis no carregamento inicial. O `scrapeWithFirecrawl` atual captura o markdown do estado inicial da página, perdendo imóveis que só aparecem após scroll ou clique.

## Solução proposta

Adicionar `actions` ao scrape em `src/server/search/firecrawl-scraper.ts`:

```typescript
result = await getFirecrawl().scrape(url, {
  timeout: 60000,
  waitFor: 3000,
  formats: ['markdown'],
  actions: [
    // Dismiss cookie/LGPD banners que bloqueiam conteúdo
    { type: 'wait', milliseconds: 1500 },
    { type: 'click', selector: 'button[id*="cookie"], .lgpd-accept, #aceitar-cookies' },
    { type: 'wait', milliseconds: 800 },
    // Scroll para triggerar lazy load / infinite scroll
    { type: 'scroll', direction: 'down', amount: 5 },
    { type: 'wait', milliseconds: 1200 },
    { type: 'scroll', direction: 'down', amount: 5 },
    { type: 'wait', milliseconds: 1000 },
    // Opcional: clicar "Ver mais" se existir
    // { type: 'click', selector: '.carregar-mais, button[class*="load-more"]' },
  ],
});
```

## Trade-offs

| Aspecto | Impacto |
|---|---|
| Créditos Firecrawl | Maior (sessão de browser mais longa) |
| Imóveis por chamada | Maior (scroll revela mais listings) |
| Custo por imóvel | Pode cair mesmo com crédito maior |
| Latência | +2–4s por scrape |
| Complexidade | Baixa (só adicionar `actions` ao objeto existente) |

## Critério de sucesso

Número médio de imóveis extraídos por URL deve aumentar ≥ 50% nos sites que usam lazy load (kariocaimoveis, newhome, etc.).

## Referência

- Firecrawl Actions docs: https://docs.firecrawl.dev/features/actions
- Arquivo a modificar: `src/server/search/firecrawl-scraper.ts` — função `scrapeWithFirecrawl`
