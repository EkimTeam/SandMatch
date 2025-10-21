#!/usr/bin/env bash
set -euo pipefail

# Deployment script with rollback support
# Requirements on VM:
# - repo cloned at /opt/sandmatch/app
# - docker and docker compose plugin installed
# - if GHCR images are private: docker login ghcr.io must be done before pulling

WEB_IMAGE="${WEB_IMAGE:-ghcr.io/OWNER/REPO/web}"
WEB_IMAGE_TAG="${WEB_IMAGE_TAG:-latest}"
APP_DIR="/opt/sandmatch/app"
PREVIOUS_TAG_FILE="$APP_DIR/.previous_image_tag"

log() { echo "[deploy] $*"; }

# Rollback function
rollback() {
  log "ROLLBACK: Starting rollback to previous version..."
  
  if [ ! -f "$PREVIOUS_TAG_FILE" ]; then
    log "ERROR: No previous version found. Cannot rollback."
    exit 1
  fi
  
  PREVIOUS_TAG=$(cat "$PREVIOUS_TAG_FILE")
  log "Rolling back to: ${WEB_IMAGE}:${PREVIOUS_TAG}"
  
  export WEB_IMAGE_TAG="$PREVIOUS_TAG"
  
  docker compose -f docker-compose.prod.yml pull web
  docker compose -f docker-compose.prod.yml up -d
  
  log "Rollback completed successfully"
  exit 0
}

# Check if rollback requested
if [ "${1:-}" = "rollback" ]; then
  rollback
fi

log "Using image: ${WEB_IMAGE}:${WEB_IMAGE_TAG}"

cd "$APP_DIR"

# Save current tag as previous (for future rollback)
if docker compose -f docker-compose.prod.yml ps web | grep -q "Up"; then
  CURRENT_TAG=$(docker compose -f docker-compose.prod.yml images web | tail -n 1 | awk '{print $2}')
  if [ -n "$CURRENT_TAG" ] && [ "$CURRENT_TAG" != "TAG" ]; then
    echo "$CURRENT_TAG" > "$PREVIOUS_TAG_FILE"
    log "Saved current version for rollback: $CURRENT_TAG"
  fi
fi

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
    log "ERROR: Health check failed after $((MAX_ATTEMPTS*SLEEP_SECS))s: $HEALTH_URL"
    log "docker compose ps:" && docker compose -f docker-compose.prod.yml ps || true
    log "Last 200 lines of web logs:" && docker compose -f docker-compose.prod.yml logs --no-color --tail=200 web || true
    
    # Auto-rollback on health check failure
    if [ -f "$PREVIOUS_TAG_FILE" ]; then
      log "Auto-rollback triggered due to health check failure"
      rollback
    else
      log "No previous version available for rollback"
      exit 1
    fi
  fi
  log "Waiting for web to become healthy... (attempt $attempt/$MAX_ATTEMPTS)"
  attempt=$((attempt+1))
  sleep $SLEEP_SECS
done

log "OK: health check passed"

# Additional check: verify frontend assets are accessible
log "Checking frontend assets..."
MANIFEST_CHECK=$(docker compose -f docker-compose.prod.yml exec -T web test -f /app/staticfiles/frontend/manifest.json && echo "OK" || echo "FAIL")
if [ "$MANIFEST_CHECK" = "FAIL" ]; then
  log "WARNING: Frontend manifest.json not found, but continuing (may be expected in some setups)"
else
  log "OK: Frontend assets verified"
fi
