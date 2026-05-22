# MKT-2 — Email de Launch para Waitlist

Email enviado via Resend para todos os contatos da waitlist no dia do launch público.

**Assunto:** PropMatch AI está no ar — sua vez chegou 🏠

---

## Template (PT-BR)

```
Assunto: PropMatch AI está no ar — sua vez chegou

Olá, {primeiro_nome}!

Você entrou na fila de espera do PropMatch AI há algum tempo.
Hoje é o dia: estamos abrindo para o público.

---

O que é o PropMatch AI?

Você recebe um briefing do cliente — "2 quartos, Vila Mariana,
até R$ 850 mil, perto do metrô" — e em segundos tem uma lista
curada de imóveis, pronta para mandar no WhatsApp.

Sem copiar e colar de portal em portal. Sem planilha.
Só você, o cliente, e o match certo.

---

Planos disponíveis hoje:

• Grátis — 3 buscas por mês, para começar a explorar
• Starter (R$ 197/mês) — 50 buscas, ideal para corretores ativos
• Pro (R$ 397/mês) — buscas ilimitadas + fontes extras

→ Criar minha conta grátis: https://propmatch.com.br/signup

---

Dúvidas? Responda este email ou fale comigo diretamente.
Fico feliz em fazer um onboarding rápido por WhatsApp.

Boas vendas,
[Nome do fundador]
PropMatch AI

---
Você recebeu este email porque entrou na waitlist em propmatch.com.br.
Para sair da lista: {unsubscribe_url}
```

---

## Variáveis Resend

| Variável | Descrição |
|----------|-----------|
| `{primeiro_nome}` | Primeiro nome do contato (fallback: "Corretor") |
| `{unsubscribe_url}` | Link de descadastro gerado pelo Resend |

---

## Checklist de envio

- [ ] Lista de waitlist exportada e carregada no Resend
- [ ] Email de teste enviado para endereço próprio e verificado em mobile e desktop
- [ ] Links de CTA testados (`/signup` abrindo corretamente)
- [ ] Link de unsubscribe funcionando
- [ ] SPF/DKIM/DMARC verificados no painel Resend (taxa de entrega > 95%)
- [ ] Agendamento definido: dia do launch, entre 09h–11h BRT

---

## Email de acompanhamento — D+3 (para quem não abriu)

**Assunto:** Ainda dá tempo — PropMatch AI aberto para novos corretores

```
Olá, {primeiro_nome}!

Lançamos o PropMatch AI há 3 dias e já temos corretores
encontrando imóveis em menos de 10 segundos.

Se você ainda não criou sua conta gratuita, ainda dá tempo:

→ https://propmatch.com.br/signup

Qualquer dúvida, é só responder.

[Nome do fundador]
```
