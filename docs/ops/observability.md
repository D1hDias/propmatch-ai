# Observability — PropMatch AI

## Componentes

| Ferramenta | Função | Configuração |
|---|---|---|
| Sentry | Rastreamento de erros + performance | DSN via `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` |
| BetterStack Logs | Logs estruturados em tempo real | Token via `BETTERSTACK_SOURCE_TOKEN` |
| BetterStack Uptime | Monitor de disponibilidade | Endpoint: `GET /api/v1/internal/health` |

## Variáveis de ambiente necessárias

```env
# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/YYY
SENTRY_DSN=https://xxx@oXXX.ingest.sentry.io/YYY
SENTRY_ORG=propmatch
SENTRY_PROJECT=propmatch-ai
SENTRY_AUTH_TOKEN=sntrys_xxx          # só no CI/deploy para upload de source maps

# BetterStack
BETTERSTACK_SOURCE_TOKEN=xxx
```

## Sentry

### Instrumentação automática
- Todos os erros não tratados em route handlers (`apiError()` em `response.ts`)
- Erros capturados via `logger.error()` quando o contexto inclui `error instanceof Error`
- Transações de performance com taxa de amostragem de 10% em produção

### Configuração por ambiente
- `sentry.client.config.ts` — browser (replay de erros habilitado)
- `sentry.server.config.ts` — Node.js runtime
- `sentry.edge.config.ts` — Edge runtime (middleware)
- `src/instrumentation.ts` — carregado pelo Next.js na inicialização

### Source maps
O `withSentryConfig` em `next.config.ts` faz upload automático dos source maps durante o build
quando `SENTRY_AUTH_TOKEN` está presente. Source maps não são expostos ao cliente (`hideSourceMaps: true`).

## BetterStack Logs

O `logger` em `src/server/lib/logger.ts` envia JSON estruturado para o drain HTTPS do BetterStack.
Cada entrada inclui `dt` (ISO 8601), `service: "propmatch"`, `level` e campos contextuais livres.

### Uso

```typescript
import { logger } from '@/server/lib/logger';

logger.info('briefing criado', { briefingId, userId });
logger.warn('confiança abaixo do limiar', { confidence, threshold: 0.85 });
logger.error('falha na extração', { error, briefingId });
```

Erros com `error instanceof Error` são automaticamente enviados ao Sentry também.

## BetterStack Uptime

Configurar no painel do BetterStack:
- **URL**: `https://app.propmatch.com.br/api/v1/internal/health`
- **Método**: GET
- **Intervalo**: 1 minuto
- **Regiões**: São Paulo + North Virginia (redundância)
- **Timeout**: 10 segundos
- **Alerta**: Slack `#ops-alerts` após 2 falhas consecutivas

A rota verifica conectividade com o banco de dados (`SELECT 1`) e retorna:
```json
{ "ok": true, "db": "up", "ts": "2026-05-05T03:00:00.000Z" }
```

## Alertas recomendados no Sentry

| Condição | Canal | Ação |
|---|---|---|
| Qualquer evento `INTERNAL_ERROR` | Slack `#ops-alerts` | Investigar imediatamente |
| Taxa de erros > 1% em 5 min | Slack `#ops-alerts` | Verificar deploy recente |
| P95 latência > 5s | Slack `#ops-alerts` | Checar DB e fontes externas |
| Novo release com regressão | Email oncall | Rollback se necessário |
