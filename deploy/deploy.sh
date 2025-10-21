#!/usr/bin/env bash
set -euo pipefail

# Simple deployment script to run on the VM via CI (SSH)
# Requirements on VM:
# - repo cloned at /opt/sandmatch/app
# - docker and docker compose plugin installed
# - if GHCR images are private: docker login ghcr.io must be done before pulling

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/OWNER/REPO/web}"
WEB_IMAGE_TAG="${WEB_IMAGE_TAG:-latest}"
APP_DIR="/opt/sandmatch/app"

log() { echo "[deploy] $*"; }

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

log "Pulling web image..."
docker compose -f docker-compose.prod.yml pull web

log "Building nginx image..."
docker compose -f docker-compose.prod.yml build nginx

# IMPORTANT: we bind-mount ./staticfiles into the container. If old assets remain on host,
# they may be stale. Clear frontend subdir to let entrypoint repopulate it.
log "Clearing old frontend assets on host (./staticfiles/frontend)..."
mkdir -p staticfiles/frontend || true
rm -rf staticfiles/frontend/* || true

log "Starting containers..."
docker compose -f docker-compose.prod.yml up -d

log "Waiting for web service to be healthy..."
sleep 5

log "Running migrations..."
docker compose -f docker-compose.prod.yml exec -T web python manage.py migrate --noinput

log "Smoke check..."

HEALTH_URL="http://127.0.0.1:8000/api/health/"
MAX_ATTEMPTS=30
SLEEP_SECS=2
attempt=1
until curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null; do
  if [ $attempt -ge $MAX_ATTEMPTS ]; then
    log "Health check failed after $((MAX_ATTEMPTS*SLEEP_SECS))s: $HEALTH_URL"
    log "docker compose ps:" && docker compose -f docker-compose.prod.yml ps || true
    log "Last 200 lines of web logs:" && docker compose -f docker-compose.prod.yml logs --no-color --tail=200 web || true
    exit 1
  fi
  log "Waiting for web to become healthy... (attempt $attempt/$MAX_ATTEMPTS)"
  attempt=$((attempt+1))
  sleep $SLEEP_SECS
done

log "OK: health check passed"
