#!/usr/bin/env bash
# OPS-12: pgBackRest backup script
# Called by systemd timer. Alternates full/diff based on day of week.
# Full backup: Sunday. Diff: Mon–Sat.
set -euo pipefail

STANZA="propmatch"
LOG_TAG="pgbackrest-backup"

log() { echo "[$(date -u +%FT%TZ)] [$LOG_TAG] $*"; }

log "Starting backup — stanza: $STANZA"

DOW=$(date +%u)  # 1=Mon … 7=Sun

if [[ "$DOW" == "7" ]]; then
  log "Sunday — running FULL backup"
  pgbackrest --stanza="$STANZA" backup --type=full
else
  log "Weekday — running DIFF backup"
  pgbackrest --stanza="$STANZA" backup --type=diff
fi

log "Backup complete. Running info:"
pgbackrest --stanza="$STANZA" info
