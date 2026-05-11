# BetterStack — Setup de Monitoramento e Status Page

> OPS-15: Configuração manual no painel BetterStack. Nenhum código necessário.

---

## 1. Uptime Monitoring

### Criar monitor principal

1. Acesse [betterstack.com](https://betterstack.com) → **Uptime** → **New monitor**
2. Configure:
   - **URL**: `https://propmatch.com.br/api/healthz`
   - **Friendly name**: PropMatch AI — App
   - **Check frequency**: 1 minuto
   - **Regions**: São Paulo, São Paulo (redundante) + Virginia (EUA)
   - **Alert after**: 2 falhas consecutivas
3. Salvar.

### Criar monitor do scraper VPS

1. **URL**: `http://<scraper-vps-ip>:3100/health` (via IP interno ou túnel)
2. **Friendly name**: PropMatch — Scraper VPS
3. **Check frequency**: 3 minutos
4. **Alertar**: qualquer falha

---

## 2. Status Page pública

1. Acesse **Status Pages** → **New status page**
2. Configure:
   - **Name**: PropMatch AI — Status
   - **Subdomain**: `status.propmatch.com.br` (requer CNAME no Cloudflare — ver passo 3)
   - **Logo**: upload do logo PropMatch
   - **Description**: "Status dos serviços da plataforma PropMatch AI"
3. Adicione os monitores criados acima à status page.
4. **Visibility**: Public
5. Salvar e publicar.

### Adicionar CNAME no Cloudflare

```
Tipo:  CNAME
Nome:  status
Valor: statuspage.betterstack.com
TTL:   Auto
Proxy: Desativado (nuvem cinza)
```

---

## 3. Alertas

### Canal de alerta principal

1. **Integrations** → **Slack** (ou e-mail)
2. Configurar webhook do canal `#incidents` do Slack ou e-mail `tech@propmatch.com.br`
3. Testar o alerta antes do lançamento

### Escalonamento

| Tempo sem resolução | Ação |
|---------------------|------|
| 5 min | Alerta Slack |
| 15 min | Alerta SMS / WhatsApp (opcional) |
| 30 min | Ligar para responsável técnico |

---

## 4. Logs (BetterStack Logs)

1. **Logs** → **New source** → **Node.js**
2. Copie o `sourceToken` gerado
3. Adicione ao `.env.production`:
   ```
   BETTERSTACK_SOURCE_TOKEN=<token>
   ```
4. O logger (`src/server/lib/logger.ts`) já envia logs para BetterStack via HTTP quando a variável está presente.

---

## 5. Verificação final

Antes do Go/No-Go, confirmar:
- [ ] Status page acessível em `https://status.propmatch.com.br`
- [ ] Monitor do app mostra **UP**
- [ ] Alerta de teste disparado e recebido no Slack
- [ ] Logs chegando no painel BetterStack
