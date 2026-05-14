# Backlog: Migrar routes autenticados para withRlsContext

**Status**: Backlog — prioridade média  
**Descoberto em**: análise de segurança (2026-05-13)

## Situação atual

Todos os route handlers autenticados já isolam dados por `WHERE userId = ctx.sub` na aplicação, então não há vazamento de dados entre brokers. Porém, as queries vão direto para o Prisma sem ativar as políticas de RLS do PostgreSQL (via `withRlsContext`).

## Risco

Não há vazamento hoje. O risco é **defensivo**: se um futuro route esquecer o filtro `userId`, o banco não vai barrar automaticamente. Com RLS ativo, o PostgreSQL barraria na camada de banco independentemente do código da aplicação (defesa em profundidade).

## Padrão correto (CLAUDE.md regra #4)

```typescript
// Atual (funciona mas sem RLS no banco):
const briefing = await prisma.briefing.findFirst({
  where: { id, userId: ctx.sub },
});

// Correto (ativa RLS do PostgreSQL via session vars):
const briefing = await withRlsContext(ctx.sub, ctx.role, async (tx) => {
  return tx.briefing.findFirst({ where: { id } });
  // RLS policy "briefings_user_isolation" filtra automaticamente por app.current_user_id
});
```

## Routes afetados

- `api/v1/briefings/[id]/search/route.ts`
- `api/v1/briefings/[id]/stream/route.ts`
- `api/v1/briefings/[id]/widen/route.ts`
- `api/v1/briefings/[id]/messages/route.ts`
- `api/v1/clients/route.ts`
- `api/v1/clients/[id]/route.ts`
- `api/v1/lgpd/export/route.ts`
- `api/v1/billing/checkout/route.ts` (só lê o próprio user — pode usar service role)
- `api/v1/billing/portal/route.ts` (idem)

## Routes que NÃO precisam de withRlsContext (service role)

- `api/v1/billing/webhook/route.ts` — Stripe webhook, sem usuário autenticado, usa `WHERE id = stripeCustomerId`
- `api/v1/internal/cron/*` — cron jobs, operam sobre todos os usuários com filtros explícitos
- `api/v1/briefings/[id]/review/route.ts` — HITL admin, deve usar service role com filtros explícitos

## Pré-requisito

Confirmar que as policies de RLS estão definidas e ativas no banco:
```sql
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public';
```

## Critério de sucesso

Todos os routes autenticados usam `withRlsContext`. Novo ESLint rule bloqueia `prisma.` direto em route handlers autenticados.
