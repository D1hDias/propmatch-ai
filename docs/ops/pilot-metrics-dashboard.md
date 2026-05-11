# OPS-9 — Pilot Metrics Dashboard (BetterStack)

## Dashboards a criar no BetterStack Logs

### 1. Briefing-to-clipboard time
- **Log query:** `action:"search.completed"` + `action:"ops.retention_job_completed"`
- **Metric:** `duration_ms` field em `audit_log`
- **Alert:** p95 > 15,000ms por 5 minutos

### 2. NLP accuracy
- **Log query:** `action:"briefing.extracted"` where `extraction_confidence` < 0.85
- **Chart:** ratio de HITL-routed vs auto-approved por hora
- **Alert:** HITL rate > 30% durante qualquer hora do pilot

### 3. Source health
- **Log query:** `source_health_check` events
- **Chart:** success rate por source (partner_a, mock) nos últimos 60min
- **Alert:** qualquer source < 80% por 10min

### 4. Queue depth
- **Log query:** `hitl.queue_depth` metric
- **Alert:** depth > 50 por > 2 minutos → PagerDuty

### 5. Error rate
- **Source:** Sentry project `propmatch-production`
- **Alert:** new issue with tag `pilot-blocker` → Slack `#pilot-brokers` + on-call

## Setup steps

1. Em BetterStack → Logs → New Dashboard → "PropMatch Pilot"
2. Adicionar cada widget acima como "Log Query Widget"
3. Em Alerting → criar alertas com os thresholds listados
4. Webhook de alerta: `https://propmatch.com.br/api/v1/internal/alerts` (OPS canal interno)

## Key log fields expected

```json
{
  "timestamp": "2026-05-01T12:00:00Z",
  "level": "info",
  "action": "briefing.extracted",
  "briefing_id": "uuid",
  "user_id": "uuid",
  "extraction_confidence": 0.91,
  "duration_ms": 320,
  "hitl_required": false
}
```
