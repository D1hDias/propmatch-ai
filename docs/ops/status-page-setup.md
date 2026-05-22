# OPS-15 — Status Page (BetterStack)

## URL pública

```
https://status.propmatch.com.br
```

Redirecionada via Caddyfile para a URL hosted do BetterStack.

---

## Setup no BetterStack (uma vez)

### 1. Criar status page

1. Acessar [betterstack.com](https://betterstack.com) → **Status Pages** → **New status page**
2. Nome: `PropMatch AI`
3. Subdomain BetterStack: `propmatch` → URL: `https://propmatch.betteruptime.com`
4. Logo: fazer upload do logo PropMatch AI
5. Cor primária: `#1921FA`

### 2. Adicionar componentes monitorados

| Componente | URL monitorada | Tipo |
|-----------|---------------|------|
| App principal | `https://propmatch.com.br/api/v1/internal/health` | HTTP keyword |
| API | `https://propmatch.com.br/api/v1/internal/health` | HTTP 200 |
| Banco de dados | Checar via health endpoint | Indiretamente |

Keyword check no health endpoint: confirmar presença de `"status":"ok"`.

### 3. Configurar domínio customizado

No painel BetterStack → Status Page Settings → Custom domain:
- Domain: `status.propmatch.com.br`
- Seguir instruções de DNS/SSL do BetterStack

No Caddyfile (já configurado):
```
status.propmatch.com.br {
  redir https://propmatch.betteruptime.com permanent
}
```

> Alternativa: usar CNAME no DNS da Cloudflare apontando `status` → `propmatch.betteruptime.com` e deixar o BetterStack gerenciar o TLS.

### 4. Configurar notificações de incidente

- On-call: e-mail do fundador + Slack `#alerts` (quando criado)
- Subscribers: formulário público na status page para clientes se inscreverem em updates

### 5. Modelo de mensagem de incidente

```
Título: Lentidão nas buscas
Impacto: Degradação parcial
Corpo: Estamos investigando lentidão nas buscas iniciadas após 14h30 BRT.
       Os resultados podem demorar mais do que o usual.
       Atualizações a cada 15 minutos.
```

---

## Verificação pós-setup

- [ ] `https://status.propmatch.com.br` redireciona para a página do BetterStack
- [ ] Componente "App principal" aparece como **Operational**
- [ ] Simular falha: derrubar health endpoint por 2 min → status page muda para **Degraded**
- [ ] E-mail de alerta recebido em < 2 min
- [ ] Inscrição de subscriber funcionando
