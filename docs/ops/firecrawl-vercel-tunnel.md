# Firecrawl → Vercel: Expor via Subdomínio Caddy

> **Objectivo**: Tornar o Firecrawl self-hosted do VPS acessível pela app na Vercel através de `https://firecrawl.propmatch.com.br`.
>
> **Contexto**: A Vercel corre em cloud — não consegue aceder a `localhost:3002` do VPS. A solução é expor o Firecrawl via subdomínio com TLS automático (Caddy + Let's Encrypt).

---

## Pré-requisitos

- [ ] Firecrawl self-hosted a correr no VPS (`systemctl is-active firecrawl` → `active`)
- [ ] Caddy a correr no VPS (`systemctl is-active caddy` → `active`)
- [ ] Acesso ao painel DNS do domínio `propmatch.com.br`
- [ ] Acesso ao painel Vercel do projecto

---

## PASSO 1 — DNS: Criar registo A para o subdomínio

No painel DNS do `propmatch.com.br` (Cloudflare, Hostinger ou outro), cria:

| Tipo | Nome | Valor | TTL |
|------|------|-------|-----|
| `A` | `firecrawl` | `IP_DO_VPS` | Auto |

> Para saber o IP do VPS: `curl -s ifconfig.me` no terminal do VPS.

**Aguarda a propagação** (geralmente 1–5 min com Cloudflare, até 30 min em outros).

Verifica com:
```bash
dig firecrawl.propmatch.com.br +short
# deve retornar o IP do VPS
```

---

## PASSO 2 — Caddy: Copiar e recarregar configuração

O bloco para `firecrawl.propmatch.com.br` já está em `infra/caddy/Caddyfile` neste repositório.

No VPS, executa:

```bash
# 1. Faz pull do repo para obter o Caddyfile actualizado
cd /opt/propmatch   # ou o directório onde está o repo no VPS
git pull origin main

# 2. Copia o Caddyfile para o local do Caddy
sudo cp infra/caddy/Caddyfile /etc/caddy/Caddyfile

# 3. Valida a configuração antes de recarregar
sudo caddy validate --config /etc/caddy/Caddyfile

# 4. Recarrega o Caddy (sem downtime)
sudo systemctl reload caddy

# 5. Confirma que o Caddy está activo
sudo systemctl status caddy
```

---

## PASSO 3 — Testar o subdomínio

```bash
# Teste 1: Sem Authorization → deve retornar 401
curl -s -o /dev/null -w "%{http_code}" \
  https://firecrawl.propmatch.com.br/v1/scrape
# Esperado: 401

# Teste 2: Com a API key → deve retornar JSON
curl -s https://firecrawl.propmatch.com.br/v1/scrape \
  -H "Authorization: Bearer propmatch-local-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}' \
  | head -c 300
# Esperado: {"success":true,"data":{"markdown":"...
```

Se o Teste 1 retornar 200 em vez de 401, verifica se o bloco `@noauth` está no Caddyfile.

---

## PASSO 4 — Vercel: Actualizar variáveis de ambiente

No painel Vercel → projecto PropMatch → **Settings → Environment Variables**:

| Variável | Valor antigo | Novo valor |
|----------|-------------|------------|
| `FIRECRAWL_API_URL` | `http://localhost:3002` | `https://firecrawl.propmatch.com.br` |
| `FIRECRAWL_API_KEY` | `propmatch-local-key` | `propmatch-local-key` (mantém) |

> Aplica as variáveis em **Production**, **Preview** e **Development** conforme necessário.

Depois de salvar, faz **redeploy** para as variáveis entrarem em vigor:
- Vercel → Deployments → clica no último deploy → **Redeploy**

---

## PASSO 5 — Verificação end-to-end

Após o redeploy, testa um sync de partner site pela UI da Vercel e confirma nos logs do Firecrawl no VPS que os requests estão a chegar:

```bash
# No VPS, monitoriza os logs do Firecrawl em tempo real
docker compose -f /opt/firecrawl/docker-compose.yaml logs -f api
```

Deves ver linhas como:
```
firecrawl-api | POST /v1/scrape 200 — 1.2s
```

---

## Troubleshooting

**`curl` retorna `000` ou connection refused**
- DNS ainda não propagou: `dig firecrawl.propmatch.com.br +short`
- Caddy não recarregou: `sudo systemctl status caddy`
- Porta 443 bloqueada no firewall do VPS: `sudo ufw allow 443/tcp`

**Caddy retorna `502 Bad Gateway`**
- Firecrawl não está a correr: `sudo systemctl status firecrawl`
- Confirma que o Firecrawl está na porta 3002: `ss -tlnp | grep 3002`

**TLS não funciona (certificado inválido)**
- Let's Encrypt ainda a emitir o certificado (aguarda 30 seg)
- Verifica se o DNS aponta para o IP correcto do VPS
- Logs do Caddy: `sudo journalctl -u caddy --since "5 minutes ago"`

**Vercel retorna erros de timeout nos scrapes**
- O `response_header_timeout` no Caddyfile está em 120s
- Vercel tem limite de 60s em serverless functions (Pro: 300s)
- Se necessário, reduz o `scrapeTimeout` nas chamadas ao Firecrawl

---

## Segurança

- O Caddy bloqueia requests sem `Authorization` header (retorna 401)
- O Firecrawl valida a API key (`propmatch-local-key`) em cada request
- O subdomínio tem TLS obrigatório via Let's Encrypt (Caddy gere automaticamente)
- **Não expões** o Firecrawl na porta 3002 directamente — a porta só deve estar acessível em `127.0.0.1:3002` (verifica com `ss -tlnp | grep 3002`)
