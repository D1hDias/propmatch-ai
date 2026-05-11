# OPS-10 — Drill: Source Failover em Staging

**Objetivo:** Validar que o runbook `runbook-source-failover.md` funciona na prática antes do launch público.

## Pré-requisitos

- Ambiente staging rodando com Source 1 (partner_a) ativo
- Acesso SSH ao VPS de staging
- Feature flag `SOURCE_2_ENABLED` disponível no `.env`

## Passos do drill

### 1. Verificar estado inicial (5 min)

```bash
# Confirmar que Source 1 está saudável
curl https://staging.propmatch.com.br/api/v1/internal/health
# Espera: { "sources": { "partner_a": "ok" } }
```

### 2. Simular falha do Source 1 (2 min)

```bash
# No VPS de staging — bloquear acesso ao endpoint do parceiro via hosts
echo "127.0.0.1 api.partner-a.com.br" | sudo tee -a /etc/hosts
```

### 3. Submeter briefing e observar (5 min)

- Criar briefing via UI ou API
- Verificar que busca retorna resultados do Source Mock (fallback)
- Verificar log: `source_health.partner_a: degraded`
- Verificar que alerta disparou no BetterStack

### 4. Ativar Source 3 via feature flag (2 min)

```bash
# No VPS de staging — adicionar ao EnvironmentFile e recarregar
echo "SOURCE_3_ENABLED=true" | sudo tee -a /etc/propmatch.env
sudo systemctl reload propmatch
```

### 5. Validar recuperação (5 min)

```bash
# Remover bloqueio do hosts
sudo sed -i '/partner-a.com.br/d' /etc/hosts
# Reiniciar health monitor
sudo systemctl reload propmatch
# Verificar que Source 1 volta ao estado ok dentro de 2 ciclos (120s)
```

### 6. Registrar resultado

- [ ] Source 1 degraded detectado em < 60s ✓/✗
- [ ] Fallback para mock funcionou ✓/✗
- [ ] Feature flag de Source 3 aplicado sem downtime ✓/✗
- [ ] Source 1 recuperado automaticamente ✓/✗
- [ ] Tempo total do drill: ___ min

## Critério de aprovação

Todos os 4 itens marcados ✓. Se qualquer um falhar, abrir ticket antes do launch público.
