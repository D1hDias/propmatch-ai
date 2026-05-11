# OPS-12 — Backup Automation com pgBackRest + R2

## Estratégia

| Tipo | Frequência | Retenção |
|------|-----------|----------|
| Full backup | Semanal (domingo 02h) | 4 semanas |
| Incremental | Diário (02h, seg–sáb) | 14 dias |
| WAL archiving | Contínuo | 7 dias |

Destino: Cloudflare R2, bucket `propmatch-backups` (separado do bucket de exports).

## Instalação no VPS

```bash
sudo apt-get install -y pgbackrest

# Criar diretório de configuração
sudo mkdir -p /etc/pgbackrest
sudo mkdir -p /var/log/pgbackrest
```

## Configuração `/etc/pgbackrest/pgbackrest.conf`

```ini
[global]
repo1-type=s3
repo1-s3-bucket=propmatch-backups
repo1-s3-endpoint=<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
repo1-s3-key=<R2_ACCESS_KEY_ID>
repo1-s3-key-secret=<R2_SECRET_ACCESS_KEY>
repo1-s3-region=auto
repo1-retention-full=4
repo1-retention-diff=14
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=<BACKUP_CIPHER_PASS>  # gerar com: openssl rand -hex 32

log-level-console=info
log-level-file=detail
log-path=/var/log/pgbackrest

[propmatch]
pg1-path=/var/lib/postgresql/16/main
pg1-user=postgres
```

## Configuração do PostgreSQL (`postgresql.conf`)

```
archive_mode = on
archive_command = 'pgbackrest --stanza=propmatch archive-push %p'
wal_level = replica
```

## Inicialização

```bash
# Criar stanza
sudo -u postgres pgbackrest --stanza=propmatch stanza-create

# Full backup inicial
sudo -u postgres pgbackrest --stanza=propmatch --type=full backup

# Verificar
sudo -u postgres pgbackrest --stanza=propmatch info
```

## Cron (systemd timer) — `/etc/systemd/system/pgbackrest.timer`

```ini
[Unit]
Description=pgBackRest backup timer

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

## Teste de restore (executar antes do launch)

```bash
# Em instância de staging separada — NUNCA no VPS de produção
sudo -u postgres pgbackrest --stanza=propmatch \
  --target-action=promote \
  --type=time \
  --target="2026-05-01 12:00:00" \
  restore

# Verificar integridade
sudo -u postgres psql -c "SELECT count(*) FROM users;"
sudo -u postgres psql -c "SELECT count(*) FROM briefings;"
```

## RTO / RPO estimado

- **RPO (perda máxima de dados):** < 5 minutos (WAL archiving contínuo)
- **RTO (tempo de recovery):** < 30 minutos para restore de full backup recente

## Alertas

- pgBackRest loga em `/var/log/pgbackrest/` — configurar BetterStack para alertar em `ERROR` nesse arquivo
- Verificar `pgbackrest info` semanalmente no runbook de ops
