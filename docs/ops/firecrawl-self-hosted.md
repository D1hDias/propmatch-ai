# Firecrawl Self-Hosted no VPS — Guia de Instalação

> **Objectivo**: Instalar o Firecrawl em modo self-hosted no VPS Hostinger para eliminar o custo por crédito e ter uso ilimitado.  
> **Audiência**: Este documento é um runbook para ser executado com **Claude Code dentro do VPS**. Cada secção contém o prompt exacto a colar no Claude Code.

---

## Contexto e Arquitectura

```
VPS Hostinger (8 GB RAM, Ubuntu)
│
├── PropMatch AI         → Next.js :3000  (systemd: propmatch.service)
├── Postgres             → :5432           (já existente)
├── Redis                → :6379           (já existente)
│
└── Firecrawl Stack (novo, Docker Compose isolado)
    ├── firecrawl-api    → :3002  (API principal — aponta FIRECRAWL_API_URL aqui)
    ├── firecrawl-worker → interno (processa jobs BullMQ)
    ├── playwright-svc   → :3000 interno (scraping com JS)
    ├── rabbitmq         → :5672 interno (fila interna Firecrawl)
    └── nuq-postgres     → :5433 interno (DB interno Firecrawl, porta diferente do Postgres existente)
```

> **Nota de isolamento**: O Firecrawl corre em rede Docker `firecrawl_backend` isolada. O Redis existente no VPS é partilhado — o Firecrawl ligará a `redis://localhost:6379`. O Postgres existente NÃO é partilhado; o Firecrawl usa o seu próprio `nuq-postgres` na porta 5433.

---

## Pré-requisitos (verificar antes de começar)

| Requisito | Versão mínima | Comando de verificação |
|-----------|--------------|----------------------|
| Docker | 24+ | `docker --version` |
| Docker Compose | 2.20+ | `docker compose version` |
| Git | qualquer | `git --version` |
| RAM livre | ≥ 3 GB | `free -h` |
| Espaço em disco | ≥ 5 GB | `df -h /` |
| Redis local | 7+ | `redis-cli ping` |

---

## FASE 1 — Preparação do VPS

### Prompt 1 — Verificar pré-requisitos

Cole este prompt no Claude Code **dentro do VPS**:

```
Verifica se o ambiente está pronto para instalar o Firecrawl self-hosted.
Executa os seguintes checks e reporta o resultado de cada um:

1. `docker --version` — deve ser 24+
2. `docker compose version` — deve ser 2.20+
3. `git --version`
4. `free -h` — verifica se há pelo menos 3 GB de RAM livre
5. `df -h /` — verifica se há pelo menos 5 GB de espaço livre
6. `redis-cli ping` — deve retornar PONG
7. `systemctl is-active propmatch` — verifica se o PropMatch está a correr
8. `ss -tlnp | grep -E '3002|5433|5672'` — verifica se as portas do Firecrawl estão livres

Se Docker não estiver instalado, instala-o com:
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker $USER

Se Docker Compose não estiver disponível como plugin, instala-o:
  apt-get install -y docker-compose-plugin

Reporta qualquer problema encontrado antes de prosseguir.
```

---

## FASE 2 — Clonar e Configurar

### Prompt 2 — Clonar repositório

```
Clona o repositório do Firecrawl e prepara o directório de instalação.

Executa:
1. Escolhe o directório de instalação: /opt/firecrawl
2. git clone https://github.com/firecrawl/firecrawl.git /opt/firecrawl
3. cd /opt/firecrawl
4. git log --oneline -5  (confirma que clonou correctamente)
5. ls -la  (lista o conteúdo)

Confirma que os ficheiros docker-compose.yaml e apps/api/.env.example existem.
```

### Prompt 3 — Criar ficheiro .env

```
Cria o ficheiro de configuração /opt/firecrawl/.env com as variáveis necessárias
para o ambiente de produção no VPS.

Lê primeiro o ficheiro /opt/firecrawl/apps/api/.env.example para ver a estrutura completa.

Depois cria /opt/firecrawl/.env com o seguinte conteúdo (substituindo os valores
marcados com <<<GERAR>>>):

---
# ============================================================
# Firecrawl Self-Hosted — Configuração PropMatch VPS
# ============================================================

# --- Servidor ---
NUM_WORKERS_PER_QUEUE=4
PORT=3002
HOST=0.0.0.0

# --- Redis (usa o Redis existente no VPS) ---
REDIS_URL=redis://host.docker.internal:6379
REDIS_RATE_LIMIT_URL=redis://host.docker.internal:6379

# --- Playwright (scraping com JavaScript) ---
PLAYWRIGHT_MICROSERVICE_URL=http://playwright-service:3000/scrape

# --- Autenticação (desabilitada — sem Supabase) ---
USE_DB_AUTHENTICATION=false

# --- PostgreSQL interno do Firecrawl ---
POSTGRES_USER=firecrawl
POSTGRES_PASSWORD=<<<GERAR: string aleatória 32 chars>>>
POSTGRES_DB=firecrawl

# --- Chave de admin para BullMQ dashboard ---
BULL_AUTH_KEY=<<<GERAR: string aleatória 32 chars>>>

# --- API Key local (pode ser qualquer string — sem créditos self-hosted) ---
TEST_API_KEY=propmatch-local-key

# --- Limites de recursos ---
MAX_CPU=0.8
MAX_RAM=0.8
CRAWL_CONCURRENT_REQUESTS=8
BROWSER_POOL_SIZE=4

# --- Logging ---
LOGGING_LEVEL=INFO

# --- Bloquear media para poupar largura de banda ---
BLOCK_MEDIA=true
---

Para gerar strings aleatórias usa: openssl rand -hex 16

Depois de criar o ficheiro, confirma o seu conteúdo com: cat /opt/firecrawl/.env
```

### Prompt 4 — Adaptar docker-compose para VPS

```
O docker-compose.yaml padrão do Firecrawl precisa de pequenos ajustes para
funcionar no VPS sem conflitos com os serviços existentes (Postgres na 5432, Redis na 6379).

Lê o ficheiro /opt/firecrawl/docker-compose.yaml e faz as seguintes alterações:

1. No serviço nuq-postgres, garante que o mapeamento de porta é "5433:5432"
   (evita conflito com o Postgres existente na 5432)

2. Em todos os serviços, adiciona extra_hosts se não existir:
   extra_hosts:
     - "host.docker.internal:host-gateway"
   (isto permite que os containers acedam ao Redis do host)

3. Remove ou comenta o serviço redis se estiver definido no docker-compose
   (vamos usar o Redis existente no host)

4. No serviço playwright-service, garante que NÃO está exposto externamente
   (apenas acessível internamente pela rede backend)

5. O serviço api deve expor apenas a porta 3002 no localhost:
   ports:
     - "127.0.0.1:3002:3002"
   (o Caddy fará proxy para esta porta — não expor directamente na internet)

Após as alterações, mostra o docker-compose.yaml final para revisão.
```

---

## FASE 3 — Build e Deploy

### Prompt 5 — Build dos containers

```
Faz o build do Firecrawl self-hosted no directório /opt/firecrawl.

Execute em ordem:
1. cd /opt/firecrawl
2. Carrega as variáveis de ambiente: set -a && source .env && set +a
3. Faz o build: docker compose build --no-cache 2>&1 | tee /tmp/firecrawl-build.log

O build vai demorar 5-15 minutos. Monitoriza o progresso.

Se houver erros no build:
- Lê os últimos 50 linhas do log: tail -50 /tmp/firecrawl-build.log
- Reporta o erro específico para diagnóstico

Quando o build terminar com sucesso, confirma: docker images | grep firecrawl
```

### Prompt 6 — Iniciar serviços

```
Inicia todos os serviços do Firecrawl em modo detached.

Execute:
1. cd /opt/firecrawl
2. docker compose up -d
3. Aguarda 30 segundos para os serviços iniciarem
4. Verifica o estado de todos os containers: docker compose ps
5. Verifica os logs de cada serviço nos primeiros 30 linhas:
   - docker compose logs api --tail=30
   - docker compose logs worker --tail=30
   - docker compose logs playwright-service --tail=30

Critério de sucesso:
- Todos os containers em estado "running" ou "healthy"
- Sem erros críticos nos logs (ECONNREFUSED ao Redis ou Postgres são críticos)
- O serviço api deve mostrar "Firecrawl API is running on port 3002"

Se algum container não estiver a correr, mostra os logs completos desse container
e diagnostica o problema.
```

### Prompt 7 — Teste de sanidade da API

```
Testa se a API do Firecrawl self-hosted está a funcionar correctamente.

Execute os seguintes testes em ordem:

1. Teste de saúde básico:
   curl -s http://localhost:3002/v1/scrape \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer propmatch-local-key" \
     -d '{"url": "https://example.com", "formats": ["markdown"]}' \
     | head -c 500

2. Teste de links (usado pelo PropMatch):
   curl -s http://localhost:3002/v1/scrape \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer propmatch-local-key" \
     -d '{"url": "https://example.com", "formats": ["links"]}' \
     | python3 -m json.tool | head -30

3. Verifica o dashboard BullMQ (substitui BULL_AUTH_KEY pelo valor no .env):
   curl -s http://localhost:3002/admin/$(grep BULL_AUTH_KEY /opt/firecrawl/.env | cut -d= -f2)/queues \
     -o /dev/null -w "%{http_code}"
   (deve retornar 200)

Reporta o resultado de cada teste. Se o scrape de example.com retornar markdown
com conteúdo, a instalação está correcta.
```

---

## FASE 4 — Configurar Proxy Caddy

### Prompt 8 — Configurar Caddy (opcional — para acesso externo seguro)

> Só necessário se quiser aceder ao Firecrawl a partir de fora do VPS ou usar um domínio.  
> Para uso exclusivo do PropMatch (que está no mesmo VPS), **não é necessário** — o PropMatch acede directamente via `http://localhost:3002`.

```
Adiciona uma entrada no Caddyfile para o Firecrawl self-hosted.
O Firecrawl só deve ser acessível internamente — NÃO expor na internet sem autenticação.

Lê o Caddyfile actual em /etc/caddy/Caddyfile ou ~/caddy/Caddyfile.

Adiciona no final (ajusta o domínio conforme necessário):

# Firecrawl — apenas acesso local/interno
firecrawl.interno {
    reverse_proxy localhost:3002
    basicauth {
        # Adiciona utilizadores se necessário
    }
}

ATENÇÃO: NÃO expões o Firecrawl publicamente sem autenticação robusta.
A API key "propmatch-local-key" não é segura para acesso externo.

Se apenas o PropMatch precisar de acesso (mesmo VPS), não é necessário configurar o Caddy.
O PropMatch acederá directamente a http://localhost:3002.

Confirma que o Caddy valida a configuração: caddy validate --config /etc/caddy/Caddyfile
```

---

## FASE 5 — Integrar com PropMatch AI

### Prompt 9 — Actualizar variáveis de ambiente do PropMatch

```
Actualiza a configuração do PropMatch AI para usar o Firecrawl self-hosted
em vez da API cloud.

1. Localiza o ficheiro de variáveis de ambiente de produção do PropMatch.
   Procura em:
   - /etc/propmatch/env  (se configurado via systemd EnvironmentFile)
   - ~/.config/propmatch/.env.production
   - /opt/propmatch/.env.local
   - Verifica a unit file: systemctl cat propmatch | grep EnvironmentFile

2. Adiciona ou actualiza as seguintes variáveis:
   FIRECRAWL_API_KEY=propmatch-local-key
   FIRECRAWL_API_URL=http://localhost:3002

3. Reinicia o serviço PropMatch:
   systemctl restart propmatch

4. Verifica que o serviço reiniciou correctamente:
   systemctl status propmatch
   journalctl -u propmatch --since "1 minute ago" | tail -20

5. Testa um scrape através do PropMatch para confirmar a integração:
   curl -s http://localhost:3000/api/v1/health
   (deve retornar 200)
```

### Prompt 10 — Verificar integração end-to-end

```
Verifica que o PropMatch está a usar o Firecrawl self-hosted correctamente.

1. Activa os logs do Firecrawl em tempo real numa janela separada:
   docker compose -f /opt/firecrawl/docker-compose.yaml logs -f api 2>&1 &
   LOGS_PID=$!

2. Dispara um sync de um partner site via PropMatch API:
   - Obtém um JWT válido para o utilizador de teste
   - POST /api/v1/partner-sites/{id}/sync

3. Observa os logs do Firecrawl — deve mostrar requests a chegar de localhost:
   grep -i "scrape\|crawl\|request" /tmp/firecrawl-api.log | tail -20

4. Para os logs: kill $LOGS_PID

5. Confirma que o sync completou com sucesso e as listagens foram indexadas.

Se aparecerem erros de autenticação (401), verifica que FIRECRAWL_API_KEY no PropMatch
corresponde ao TEST_API_KEY definido no .env do Firecrawl.
```

---

## FASE 6 — Systemd para auto-arranque

### Prompt 11 — Criar serviço systemd para Firecrawl

```
Cria um serviço systemd para que o Firecrawl inicie automaticamente com o VPS.

Cria o ficheiro /etc/systemd/system/firecrawl.service com o seguinte conteúdo:

[Unit]
Description=Firecrawl Self-Hosted
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/firecrawl
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose pull && /usr/bin/docker compose up -d
TimeoutStartSec=300
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target

Depois:
1. systemctl daemon-reload
2. systemctl enable firecrawl
3. systemctl start firecrawl
4. systemctl status firecrawl

Confirma que o serviço está activo e configurado para arrancar automaticamente.
```

---

## FASE 7 — Manutenção e Updates

### Prompt de Update (usar quando necessário)

```
Actualiza o Firecrawl self-hosted para a versão mais recente.

Execute:
1. cd /opt/firecrawl
2. git pull origin main
3. docker compose build --no-cache
4. docker compose up -d --remove-orphans
5. docker compose ps  (verifica estado)
6. docker system prune -f  (limpa imagens antigas)

Testa após o update:
curl -s http://localhost:3002/v1/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer propmatch-local-key" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}' \
  | head -c 200
```

### Prompt de Diagnóstico (usar se houver problemas)

```
Diagnostica problemas no Firecrawl self-hosted.

Execute:
1. docker compose -f /opt/firecrawl/docker-compose.yaml ps
2. docker compose -f /opt/firecrawl/docker-compose.yaml logs api --tail=50
3. docker compose -f /opt/firecrawl/docker-compose.yaml logs worker --tail=50
4. curl -s http://localhost:3002/v1/scrape \
     -H "Authorization: Bearer propmatch-local-key" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://example.com","formats":["markdown"]}' | head -c 300
5. redis-cli ping  (verifica Redis local)
6. df -h /  (verifica espaço em disco)
7. free -h  (verifica RAM disponível)

Reporta o output de cada comando para diagnóstico.
```

### Prompt de Limpeza de Logs (usar semanalmente)

```
Limpa logs e imagens Docker antigas do Firecrawl para libertar espaço.

Execute:
1. docker system prune --volumes -f  (CUIDADO: remove volumes não utilizados)
2. journalctl --vacuum-time=7d  (limpa logs do systemd mais antigos que 7 dias)
3. df -h /  (confirma libertação de espaço)

NÃO executar durante um sync activo do PropMatch.
Verificar primeiro: docker compose -f /opt/firecrawl/docker-compose.yaml ps
```

---

## Referência Rápida

### Comandos essenciais no VPS

```bash
# Estado dos serviços
docker compose -f /opt/firecrawl/docker-compose.yaml ps

# Logs em tempo real
docker compose -f /opt/firecrawl/docker-compose.yaml logs -f api

# Reiniciar
systemctl restart firecrawl

# Parar
systemctl stop firecrawl

# Dashboard BullMQ (substituir BULL_KEY)
open http://SEU_VPS:3002/admin/BULL_KEY/queues

# Testar API
curl http://localhost:3002/v1/scrape \
  -H "Authorization: Bearer propmatch-local-key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","formats":["links"]}'
```

### Variáveis a adicionar ao PropMatch em produção

```bash
# No EnvironmentFile do systemd propmatch.service
FIRECRAWL_API_KEY=propmatch-local-key
FIRECRAWL_API_URL=http://localhost:3002
```

### Recursos estimados no VPS

| Serviço | RAM | CPU |
|---------|-----|-----|
| firecrawl-api | ~500 MB | baixo |
| firecrawl-worker (×4) | ~800 MB | médio |
| playwright-service | ~1.5 GB | alto (durante scraping) |
| nuq-postgres | ~200 MB | baixo |
| rabbitmq | ~150 MB | baixo |
| **Total** | **~3.2 GB** | |

> Com 8 GB RAM no VPS e ~2 GB usados pelo PropMatch + Redis + Postgres existente, sobram ~2.8 GB — suficiente com alguma margem.

### Limitação conhecida do self-hosted

O Firecrawl self-hosted **não tem acesso ao Fire-engine** (sistema anti-bot da Firecrawl cloud). Isso significa:
- Sites com **Cloudflare agressivo** podem bloquear o scraping
- **CAPTCHAs** não são resolvidos automaticamente
- Para a Karioca e maioria das imobiliárias brasileiras com SSR simples, **não é problema**
- Se um site bloquear, a solução é configurar proxies rotativos (`PROXY_SERVER` no .env)

---

## Checklist Final

Após seguir todos os prompts, confirma:

- [ ] `docker compose ps` mostra todos os containers `running`
- [ ] `curl http://localhost:3002/v1/scrape` retorna markdown de example.com
- [ ] PropMatch reiniciado com `FIRECRAWL_API_URL=http://localhost:3002`
- [ ] Sync de teste da Karioca completa sem erros de créditos
- [ ] Listagem KR736303P2P aparece nos resultados de busca
- [ ] Serviço systemd `firecrawl` está `enabled` para auto-arranque
