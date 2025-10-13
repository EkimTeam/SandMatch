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

log "Pulling image..."
docker compose -f docker-compose.prod.yml pull web

log "Starting containers..."
docker compose -f docker-compose.prod.yml up -d web

log "Running migrations..."
docker compose -f docker-compose.prod.yml exec -T web python manage.py migrate --noinput

log "Smoke check..."
curl -fsS http://127.0.0.1:8000/api/health/ >/dev/null
log "OK"
