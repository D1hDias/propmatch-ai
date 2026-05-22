# QA-10 — Chaos Engineering: Postgres Kill Test

## Objetivo

Validar que o app se comporta de forma previsível quando o Postgres cai inesperadamente:
- Requests em curso retornam 503 ou erro amigável, **não crash silencioso**
- Prisma reconecta automaticamente quando o DB volta
- Sentry registra erros de conexão com contexto suficiente
- Nenhum dado é corrompido ou perdido

## Pré-requisitos

- Ambiente: **staging** (nunca produção)
- BetterStack monitorando staging
- Sentry configurado para staging
- App rodando com ao menos 1 usuário autenticado na sessão

---

## Procedimento

### 1. Baseline — confirmar saúde antes do teste

```bash
# App responde
curl -sf https://staging.propmatch.com.br/api/v1/internal/health | jq .

# Postgres respondendo
sudo -u postgres psql -c "SELECT now();"

# Verificar connections ativas
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';"
```

### 2. Iniciar carga leve (terminal separado)

```bash
# Simular requests contínuos durante o kill
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TEST_TOKEN" \
    https://staging.propmatch.com.br/api/v1/briefings)
  echo "$(date -u +%T) HTTP $STATUS"
  sleep 1
done
```

### 3. Matar o Postgres

```bash
# Opção A: parar graciosamente (simula manutenção)
sudo systemctl stop postgresql

# Opção B: kill forçado (simula crash de processo)
sudo kill -9 $(sudo -u postgres psql -tAc "SELECT pg_backend_pid();")
```

### 4. Observar comportamento (2 minutos)

Resultados esperados:
- [ ] Requests retornam HTTP 503 ou 500 com body JSON `{ "error": { "code": "..." } }`
- [ ] Nenhum request trava indefinidamente (timeout deve ser < 30s)
- [ ] App **não crasha** — processo Next.js continua rodando
- [ ] Sentry registra erro de conexão com tag `environment=staging`
- [ ] BetterStack alerta de saúde do endpoint `/api/v1/internal/health`

### 5. Restaurar Postgres

```bash
sudo systemctl start postgresql

# Verificar que voltou
sudo -u postgres psql -c "SELECT now();"
```

### 6. Verificar reconexão automática (2 minutos após restart)

- [ ] Requests voltam a retornar HTTP 200 sem reiniciar o app
- [ ] `pg_stat_activity` mostra conexões do Prisma connection pool
- [ ] Nenhum dado foi corrompido (`SELECT count(*) FROM briefings;` bate com baseline)

---

## Critérios de aprovação

| Critério | Esperado | Observado |
|----------|----------|-----------|
| HTTP durante queda | 503 / 500 com JSON | — |
| Processo Next.js | Continua rodando | — |
| Tempo de reconexão | < 30s após DB voltar | — |
| Dados corrompidos | Nenhum | — |
| Sentry registrou | Sim, com contexto | — |
| BetterStack alertou | Sim, < 2 min | — |

---

## Problemas conhecidos / mitigações

| Problema | Mitigação já implementada |
|----------|--------------------------|
| Prisma não reconecta após kill | `datasource` com `connection_limit` e retry configurados |
| SSE streams pendurados | Timeout de 65s no Caddyfile + `response_header_timeout` |
| HITL queue jobs perdidos | BullMQ persiste jobs no Redis — Postgres kill não afeta |

---

## Pós-teste

```bash
# Confirmar integridade final
sudo -u postgres psql propmatch -c "
  SELECT 'users' AS tbl, count(*) FROM users
  UNION ALL SELECT 'briefings', count(*) FROM briefings
  UNION ALL SELECT 'messages', count(*) FROM messages;
"

# Comparar com baseline registrado no início
```

Documentar resultado na tabela de critérios acima e anexar ao PR de evidência.
