# Deploy — PropMatch AI no VPS

Guia completo para colocar o PropMatch AI em produção no VPS (Hostinger / Ubuntu 22.04).

---

## Pré-requisitos no VPS

| Software | Versão | Como instalar |
|----------|--------|---------------|
| Node.js  | ≥ 20   | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo bash -` |
| pnpm     | ≥ 9    | `npm install -g pnpm` |
| Git      | qualquer | `sudo apt install git` |
| Caddy    | ≥ 2.8  | <https://caddyserver.com/docs/install#debian-ubuntu-raspbian> |
| PostgreSQL | 16  | instalado via Docker Compose no VPS ou nativamente |
| Redis    | 7      | instalado via Docker Compose no VPS ou nativamente |

---

## 1. Criar usuário de serviço

```bash
sudo adduser --system --group --home /opt/propmatch --shell /bin/bash propmatch
```

---

## 2. Clonar o repositório

```bash
sudo -u propmatch git clone https://github.com/D1hDias/propmatch-ai.git /opt/propmatch
```

---

## 3. Configurar variáveis de ambiente

Crie o arquivo `/etc/propmatch.env` (lido pelo systemd via `EnvironmentFile`):

```bash
sudo nano /etc/propmatch.env
```

Conteúdo mínimo para produção (preencha todos os valores):

```ini
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://propmatch.com.br
NEXT_PUBLIC_BASE_URL=https://propmatch.com.br

# Database — PostgreSQL
DATABASE_URL=postgresql://propmatch:SENHA_SEGURA@localhost:5432/propmatch_prod

# Redis
REDIS_URL=redis://:SENHA_REDIS@localhost:6379

# Auth — gere com: openssl rand -base64 64
JWT_SECRET=TROQUE_AQUI
JWT_REFRESH_SECRET=TROQUE_AQUI
ARGON2_PEPPER=TROQUE_AQUI

# LLM via OpenRouter
OPENROUTER_API_KEY=sk-or-v1-CHAVE_OPENROUTER

# Email (Resend)
RESEND_API_KEY=re_CHAVE_RESEND

# Stripe
STRIPE_SECRET_KEY=sk_live_CHAVE_STRIPE
STRIPE_WEBHOOK_SECRET=whsec_WEBHOOK_SECRET

# Observabilidade
SENTRY_DSN=https://SENTRY_DSN
NEXT_PUBLIC_SENTRY_DSN=https://SENTRY_DSN

# Firecrawl self-hosted
FIRECRAWL_API_URL=https://firecrawl.propmatch.com.br
FIRECRAWL_API_KEY=CHAVE_FIRECRAWL

# Scraping real (não mock)
SOURCE_MOCK=false

# Cron protection
CRON_SECRET=TROQUE_AQUI
```

Proteja o arquivo:

```bash
sudo chmod 600 /etc/propmatch.env
sudo chown root:propmatch /etc/propmatch.env
```

---

## 4. Instalar dependências e fazer o build inicial

```bash
cd /opt/propmatch
sudo -u propmatch pnpm install --frozen-lockfile
sudo -u propmatch pnpm prisma migrate deploy
sudo -u propmatch pnpm build
```

---

## 5. Instalar o serviço systemd

```bash
sudo cp /opt/propmatch/infra/systemd/propmatch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable propmatch
sudo systemctl start propmatch
sudo systemctl status propmatch
```

Verificar logs em tempo real:

```bash
journalctl -u propmatch -f
```

---

## 6. Configurar o Caddy

```bash
sudo cp /opt/propmatch/infra/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O Caddy obtém TLS automaticamente via Let's Encrypt. Certifique-se de que:
- DNS de `propmatch.com.br` e `www.propmatch.com.br` apontam para o IP do VPS.
- Portas 80 e 443 abertas no firewall.

---

## 7. Serviços de cron (retenção de dados / backup)

```bash
sudo cp /opt/propmatch/infra/systemd/propmatch-retention.service /etc/systemd/system/
sudo cp /opt/propmatch/infra/systemd/propmatch-retention.timer /etc/systemd/system/
sudo cp /opt/propmatch/infra/systemd/propmatch-backup.service /etc/systemd/system/
sudo cp /opt/propmatch/infra/systemd/propmatch-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now propmatch-retention.timer
sudo systemctl enable --now propmatch-backup.timer
```

---

## 8. Deploy de atualizações

### Manual

```bash
bash /opt/propmatch/infra/deploy/deploy.sh
```

### Via GitHub Actions (SSH)

Configure os seguintes secrets no repositório (`Settings → Secrets → Actions`):

| Secret | Valor |
|--------|-------|
| `VPS_HOST` | IP ou domínio do VPS |
| `VPS_USER` | `propmatch` |
| `VPS_SSH_KEY` | chave privada SSH do usuário `propmatch` |

O workflow dispara em push para `main` e executa `deploy.sh` via SSH.

---

## 9. Verificar saúde

```bash
# Serviço rodando
systemctl status propmatch

# App respondendo
curl -I https://propmatch.com.br

# Logs recentes
journalctl -u propmatch -n 100 --no-pager
```

---

## Rollback rápido

```bash
cd /opt/propmatch
git log --oneline -10        # escolha o commit anterior
git checkout <COMMIT_HASH>   # volta o código
pnpm build
sudo systemctl restart propmatch
```

---

## Troubleshooting comum

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| `502 Bad Gateway` | Next.js não iniciou | `journalctl -u propmatch -n 50` |
| Erro de migração | DB inacessível ou schema divergente | Verificar `DATABASE_URL` e status do Postgres |
| Build falha | Variável de ambiente ausente | Conferir `/etc/propmatch.env` vs `.env.example` |
| TLS não funciona | DNS não propagou | `dig propmatch.com.br` + aguardar TTL |
| Redis connection refused | Redis não iniciou | `systemctl status redis` |
