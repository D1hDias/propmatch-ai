# OPS-11 — LGPD Manual Deletion Dry-Run

**Objetivo:** Ensaiar o processo completo de exclusão de dados (DSAR delete) com counsel antes do launch.
**Quem participa:** Tech Lead, Ops, advogado brasileiro de privacidade de dados.
**Duração estimada:** 2 horas.

## Roteiro

### Fase 1 — Preparação (30 min antes)

1. Criar conta de teste em staging: `test-dsar@counsel.propmatch.ai`
2. Submeter 3 briefings com dados fictícios pela conta de teste
3. Confirmar que `users`, `briefings`, `clients`, `messages` e `audit_log` têm registros

### Fase 2 — Solicitação (com counsel observando)

1. Counsel age como titular dos dados e solicita exclusão via API:
   ```bash
   curl -X POST https://staging.propmatch.com.br/api/v1/lgpd/delete \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json"
   ```
2. Verificar resposta: `job_id`, `cancellation_token`, `grace_period_ends_at`
3. Verificar que `lgpd_jobs` tem registro com `status = cancellable`
4. Verificar que `audit_log` registrou `lgpd.delete_requested`

### Fase 3 — Janela de cancelamento (simular d+1)

1. Avançar job para `in_progress` manualmente (simular 7 dias):
   ```sql
   UPDATE lgpd_jobs
   SET status = 'in_progress', requested_at = NOW() - INTERVAL '8 days'
   WHERE id = '<job_id>';
   ```
2. Rodar o cron de retenção manualmente:
   ```bash
   curl -X POST https://staging.propmatch.com.br/api/v1/internal/run-retention \
     -H "X-Internal-Key: <INTERNAL_API_KEY>"
   ```

### Fase 4 — Verificação de exclusão (counsel sign-off)

Verificar que:
- [ ] `users.email` foi anonimizado para `deleted_*@deleted.local`
- [ ] `users.name` = `[Conta excluída]`
- [ ] `users.phone` = NULL
- [ ] `users.password_hash` = `[deleted]`
- [ ] Todos os `refresh_tokens` do usuário estão `revoked_at IS NOT NULL`
- [ ] `lgpd_jobs.status` = `completed`
- [ ] `audit_log` mantém registros (retenção legal 24 meses) — `actor_user_id` ainda presente
- [ ] Login com as credenciais originais retorna 401

### Fase 5 — Sign-off

Counsel assina o seguinte (por e-mail, arquivar em `/docs/legal/`):

> "Participei do ensaio do processo de exclusão de dados da PropMatch AI em [data]. O processo
> atende aos requisitos do Art. 18 da LGPD para exclusão de dados pessoais, incluindo prazo de
> 7 dias para cancelamento e retenção de logs de auditoria pelo período legal mínimo."

**Sign-off é gate de launch público.** Não lançar sem este documento.

## Contato counsel

A preencher pelo time.
