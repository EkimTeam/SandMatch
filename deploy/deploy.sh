#!/usr/bin/env bash
set -euo pipefail

# Simple deployment script to run on the VM via CI (SSH)
# Requirements on VM:
# - repo cloned at /opt/sandmatch/app
# - docker and docker compose plugin installed
# - if GHCR images are private: docker login ghcr.io must be done before pulling

# Auto-detect environment
if [ -f "docker-compose.prod.yml" ]; then
    COMPOSE_FILE="docker-compose.prod.yml"
else
    COMPOSE_FILE="docker-compose.yml" 
fi
export COMPOSE_FILE

log() { echo "[deploy] $*"; }
log "Using compose file: $COMPOSE_FILE"

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/ekimteam/sandmatch/web}"
WEB_IMAGE_TAG="${WEB_IMAGE_TAG:-latest}"
APP_DIR="/opt/sandmatch/app"

log "Using image: ${WEB_IMAGE}:${WEB_IMAGE_TAG}"

cd "$APP_DIR"

# Fetch latest repo state (idempotent)
if git rev-parse --git-dir >/dev/null 2>&1; then
  log "Updating repository..."
  git fetch --all --prune
  git reset --hard origin/main || true
else
  log "WARNING: not a git repo at $APP_DIR; skipping git pull"
fi

# Export variables for compose
export WEB_IMAGE
export WEB_IMAGE_TAG

log "Pulling image..."
docker compose pull web

# Очистка старой структуры статики и подготовка новой
log "Cleaning old static structure..."
rm -rf staticfiles/ || true  # удалить старую папку staticfiles
mkdir -p static/ || true     # убедиться что static существует

# Очистка фронтенд ассетов (Vite build)
log "Clearing old frontend assets on host (./static/frontend)..."
mkdir -p static/frontend || true
rm -rf static/frontend/* || true

log "Starting containers..."
docker compose up -d web

log "Running migrations..."
docker compose exec -T web python manage.py migrate --noinput

# Сборка статики Django + фронтенда
log "Collecting static files..."
docker compose exec -T web python manage.py collectstatic --noinput --clear

log "Smoke check..."

HEALTH_URL="http://127.0.0.1:8000/api/health/"
MAX_ATTEMPTS=30
SLEEP_SECS=2
attempt=1
until curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null; do
  if [ $attempt -ge $MAX_ATTEMPTS ]; then
    log "Health check failed after $((MAX_ATTEMPTS*SLEEP_SECS))s: $HEALTH_URL"
    log "docker compose ps:" && docker compose ps || true
    log "Last 200 lines of web logs:" && docker compose logs --no-color --tail=200 web || true
    exit 1
  fi
  log "Waiting for web to become healthy... (attempt $attempt/$MAX_ATTEMPTS)"
  attempt=$((attempt+1))
  sleep $SLEEP_SECS
done

log "OK: health check passed"
