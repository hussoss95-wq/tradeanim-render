#!/usr/bin/env sh
# Production start command for the AlgoLiquid Studio render API.
# Single process on purpose: render jobs and the queue live in memory, and
# renders run in child worker processes (one at a time).
set -eu
cd "$(dirname "$0")/../.."
export APP_ENV="${APP_ENV:-production}"
export MPLBACKEND=Agg
exec python -m uvicorn app:app \
  --app-dir services/render-api \
  --host "${HOST:-0.0.0.0}" \
  --port "${PORT:-8000}" \
  --workers 1 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
  --timeout-graceful-shutdown 30 \
  --log-level "${LOG_LEVEL:-info}" \
  --no-server-header
