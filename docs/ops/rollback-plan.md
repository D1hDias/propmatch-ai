# Plano de Rollback — PropMatch AI

> Atualizar este documento a cada deploy. Manter os hashes de commit e snapshots do banco sempre atualizados.

---

## Gatilhos para rollback

Qualquer um dos seguintes justifica rollback imediato (sem esperar aprovação):

- Taxa de erro HTTP > 5% por 5 minutos consecutivos (BetterStack alerta)
- p95 de latência > 10s por 5 minutos
- Workers BullMQ parados (HITL ou export queue depth subindo sem processamento)
- Falha de autenticação em cascata (> 10 erros 401/403 por minuto)
- Dados de usuário B visíveis para usuário A (violação de RLS) — rollback + incidente imediato

---

## Procedimento de rollback da aplicação

### Passo 1 — Identificar o commit estável anterior

```bash
# Na VPS principal
cd /opt/propmatch
git log --oneline -10
# Anotar o hash do commit estável anterior
```

### Passo 2 — Reverter o código

```bash
git checkout <hash-estavel>
pnpm install --frozen-lockfile
pnpm build
```

### Passo 3 — Reiniciar o serviço

```bash
sudo systemctl restart propmatch
sudo systemctl status propmatch  # confirmar active (running)
```

### Passo 4 — Verificar

```bash
curl https://propmatch.com.br/api/v1/health
# Deve retornar 200 com { status: "ok" }
```

**Tempo alvo: < 5 minutos do gatilho ao serviço rodando.**

---

## Procedimento de rollback do banco de dados

> ⚠️ Fazer rollback de migration é destrutivo se dados foram escritos. Avaliar cuidadosamente.

### Opção A — Desfazer migration (sem dados novos)

```bash
# Checar migrations aplicadas
npx prisma migrate status

# Reverter última migration (se reversível — checar migration.sql)
psql $DATABASE_URL -f prisma/migrations/<migration_name>/down.sql
npx prisma migrate resolve --rolled-back <migration_name>
```

### Opção B — Restaurar backup (dados perdidos desde o backup)

```bash
# Listar backups disponíveis
pgbackrest --stanza=propmatch info

# Restaurar (parar app primeiro!)
sudo systemctl stop propmatch
pgbackrest --stanza=propmatch --delta restore
sudo systemctl start postgresql
sudo systemctl start propmatch
```

**Nota**: Restaurar backup implica perda de dados criados após o backup. Comunicar usuários afetados conforme LGPD.

---

## Rollback do scraper VPS

```bash
# Na scraper VPS
cd /opt/propmatch-scraper
git checkout <hash-estavel>
sudo systemctl restart propmatch-scraper
curl http://localhost:3100/health
```

---

## Rollback de feature flags

Para desativar uma fonte sem rollback completo:

```bash
# Desativar Source 2 (portal_x)
# Remover SCRAPER_VPS_URL do EnvironmentFile e recarregar
sudo systemctl edit --force propmatch  # remover SCRAPER_VPS_URL
sudo systemctl daemon-reload
sudo systemctl restart propmatch

# Desativar Source 3 (partner_b)
# Setar FEATURE_SOURCE_PARTNER_B=false e recarregar
```

---

## Comunicação durante rollback

| Público | Canal | Responsável | Mensagem padrão |
|---------|-------|-------------|-----------------|
| Usuários | Status page (BetterStack) | Dev on-call | "Manutenção em andamento — serviço em restauração" |
| Equipe | Slack #incidents | Dev on-call | Hash revertido, causa, ETA de resolução |
| Clientes piloto | WhatsApp direto | CEO | Mensagem personalizada se impacto > 15 min |

---

## Checklist pós-rollback

- [ ] Serviço respondendo normalmente (health check OK)
- [ ] Logs sem erros novos
- [ ] Sentry sem novos eventos
- [ ] BetterStack alerta resolvido
- [ ] Post-mortem agendado em < 48h
- [ ] Causa raiz identificada antes do próximo deploy

---

## Histórico de rollbacks

| Data | Versão revertida | Causa | Tempo de resolução |
|------|-----------------|-------|-------------------|
| — | — | — | — |
