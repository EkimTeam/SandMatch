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

  PREV_REF=$(cat "$PREVIOUS_TAG_FILE" | tr -d '\n' | tr -d '\r')
  if [ -z "$PREV_REF" ]; then
    log "ERROR: Previous image reference is empty. Cannot rollback."
    exit 1
  fi

  # PREV_REF format: registry/repo/web:tag (or without tag -> latest)
  if [[ "$PREV_REF" == *":"* ]]; then
    PREV_IMAGE="${PREV_REF%:*}"
    PREV_TAG="${PREV_REF##*:}"
  else
    PREV_IMAGE="$PREV_REF"
    PREV_TAG="latest"
  fi

  log "Rolling back to: ${PREV_IMAGE}:${PREV_TAG}"

  export WEB_IMAGE="$PREV_IMAGE"
  export WEB_IMAGE_TAG="$PREV_TAG"

  docker compose -f docker-compose.prod.yml pull web || true
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

# Save current image reference as previous (for future rollback)
if docker compose -f docker-compose.prod.yml ps web | grep -q "Up"; then
  CID=$(docker compose -f docker-compose.prod.yml ps -q web || true)
  if [ -n "$CID" ]; then
    CURRENT_REF=$(docker inspect -f '{{.Config.Image}}' "$CID" 2>/dev/null || true)
    if [ -n "$CURRENT_REF" ]; then
      echo "$CURRENT_REF" > "$PREVIOUS_TAG_FILE"
      log "Saved current version for rollback: $CURRENT_REF"
    else
      log "WARNING: Could not determine current image for web"
    fi
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

log "Smoke check (inside web container)..."

MAX_ATTEMPTS=40
SLEEP_SECS=3
attempt=1
until docker compose -f docker-compose.prod.yml exec -T web sh -c \
  "curl -fsS --max-time 2 http://localhost:8000/api/health/ >/dev/null && test -f /app/staticfiles/frontend/manifest.json"; do
  if [ $attempt -ge $MAX_ATTEMPTS ]; then
    log "ERROR: Health check failed after $((MAX_ATTEMPTS*SLEEP_SECS))s inside web: http://localhost:8000/api/health/ or missing manifest.json"
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

log "OK: health check passed inside web"
