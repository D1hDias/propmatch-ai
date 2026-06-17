#!/usr/bin/env bash
# PropMatch AI — deploy script executado no VPS via GitHub Actions (SSH)
# Uso manual: bash /opt/propmatch/infra/deploy/deploy.sh
set -euo pipefail

APP_DIR="/opt/propmatch"
SERVICE="propmatch"
NODE_ENV="production"

echo "==> [$(date -u +%H:%M:%S)] Iniciando deploy"

cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull origin main

echo "==> Installing dependencies (pnpm)..."
pnpm install --frozen-lockfile --prod=false

echo "==> Running database migrations..."
NODE_ENV=$NODE_ENV pnpm prisma migrate deploy

echo "==> Building Next.js..."
NODE_ENV=$NODE_ENV pnpm build

echo "==> Reloading service..."
sudo systemctl reload-or-restart "$SERVICE"

echo "==> Waiting for service to become healthy..."
sleep 5
if systemctl is-active --quiet "$SERVICE"; then
  echo "==> [OK] $SERVICE is running"
else
  echo "==> [ERRO] $SERVICE falhou — verificando logs:"
  journalctl -u "$SERVICE" -n 50 --no-pager
  exit 1
fi

echo "==> Deploy concluído em $(date -u)"
