#!/usr/bin/env bash
set -euo pipefail

# Enhanced deployment script with rollback and advanced health checks
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
sudo chown -R ubuntu:ubuntu static/ 2>/dev/null || true
sudo chmod -R 775 static/ 2>/dev/null || true

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

# ============================================================================
# 1. МИГРАЦИИ С ОТКАТОМ
# ============================================================================

log "Running migrations with rollback protection..."

# Бэкап БД перед миграциями
BACKUP_FILE="/tmp/sandmatch_backup_$(date +%Y%m%d_%H%M%S).json"
log "Creating database backup: $BACKUP_FILE"
docker compose exec -T web python manage.py dumpdata \
    --natural-foreign \
    --exclude=contenttypes \
    --exclude=auth.Permission \
    --exclude=admin.logentry \
    --indent=2 > "$BACKUP_FILE"

# Проверить что бэкап создался
if [ ! -s "$BACKUP_FILE" ]; then
    log "ERROR: Backup file is empty or not created"
    exit 1
fi
BACKUP_SIZE=$(wc -l < "$BACKUP_FILE")
log "Backup created successfully ($BACKUP_SIZE lines)"

# Выполнить миграции
if docker compose exec -T web python manage.py migrate --noinput; then
    log "Migrations completed successfully"
    
    # Удалить старые бэкапы (оставить последние 5)
    find /tmp -name "sandmatch_backup_*.json" -type f | sort -r | tail -n +6 | xargs rm -f --
else
    log "ERROR: Migrations failed! Restoring from backup..."
    
    # Откат к последней успешной миграции
    LAST_GOOD_MIGRATION=$(docker compose exec -T web python manage.py showmigrations | grep -B1 "\[X\]" | grep -v "\[X\]" | tail -1 | awk '{print $1}')
    if [ -n "$LAST_GOOD_MIGRATION" ]; then
        log "Rolling back to: $LAST_GOOD_MIGRATION"
        docker compose exec -T web python manage.py migrate "$LAST_GOOD_MIGRATION" --noinput
    fi
    
    # Восстановление данных
    log "Restoring data from backup..."
    docker compose exec -T web python manage.py flush --noinput
    docker compose exec -T web python manage.py loaddata "$BACKUP_FILE"
    
    log "Database restored from backup: $BACKUP_FILE"
    exit 1
fi

# Сборка статики Django + фронтенда
log "Collecting static files..."
docker compose exec -T web python manage.py collectstatic --noinput --clear

# ============================================================================
# 2. БАЗОВЫЙ HEALTH CHECK
# ============================================================================

log "Basic health check..."

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

log "✅ Basic health check passed"

# ============================================================================
# 3. ПРОДВИНУТЫЕ HEALTH CHECKS
# ============================================================================

log "Running advanced smoke tests..."

# Проверка основных API endpoints
SMOKE_TESTS=(
    "/api/tournaments/"
    "/api/players/" 
    "/api/teams/"
)

for endpoint in "${SMOKE_TESTS[@]}"; do
    SMOKE_URL="https://beachplay.ru${endpoint}"
    log "Testing API: $SMOKE_URL"
    
    RESPONSE_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SMOKE_URL")
    if [ "$RESPONSE_CODE" -ne 200 ] && [ "$RESPONSE_CODE" -ne 401 ] && [ "$RESPONSE_CODE" -ne 403 ]; then
        log "ERROR: Smoke test failed for $SMOKE_URL (HTTP $RESPONSE_CODE)"
        
        # Детальная диагностика
        log "Detailed response:"
        curl -v "$SMOKE_URL" --max-time 5 2>&1 | head -20 || true
        
        exit 1
    fi
    log "✅ API $endpoint: HTTP $RESPONSE_CODE"
done

# Проверка статики
log "Testing static files..."
STATIC_PATTERNS=(
    "/static/frontend/assets/main-*.js"
    "/static/frontend/assets/main-*.css"
    "/static/img/logo.png"
)

for pattern in "${STATIC_PATTERNS[@]}"; do
    # Найти реальное имя файла
    if [ "$pattern" = "/static/img/logo.png" ]; then
        STATIC_URL="https://beachplay.ru/static/img/logo.png"
    else
        # Для JS/CSS файлов найти актуальное имя с хешем
        ACTUAL_FILE=$(find /opt/sandmatch/app/static/ -path "*${pattern/\*/}" -name "*.${pattern##*.}" | head -1)
        if [ -n "$ACTUAL_FILE" ]; then
            FILENAME=$(basename "$ACTUAL_FILE")
            DIRNAME=$(basename "$(dirname "$ACTUAL_FILE")")
            STATIC_URL="https://beachplay.ru/static/frontend/${DIRNAME}/${FILENAME}"
        else
            log "WARNING: Static file not found for pattern: $pattern"
            continue
        fi
    fi
    
    if curl -fsS --max-time 5 "$STATIC_URL" > /dev/null; then
        log "✅ Static file: $STATIC_URL"
    else
        log "ERROR: Static file not accessible: $STATIC_URL"
        exit 1
    fi
done

# ============================================================================
# 4. ГЛУБОКАЯ ПРОВЕРКА (DEEP HEALTH CHECK)
# ============================================================================

log "Running deep health check..."

# Проверка глубокого health check (если endpoint существует)
DEEP_HEALTH_URL="https://beachplay.ru/api/health/deep/"
BASIC_DEEP_CHECK_URL="https://beachplay.ru/api/health/"

# Сначала проверяем базовый health
if curl -fsS --max-time 10 "$BASIC_DEEP_CHECK_URL" > /dev/null; then
    log "✅ Basic deep health endpoint"
    
    # Пытаемся получить детализированную информацию
    DEEP_RESPONSE=$(curl -s --max-time 10 "$DEEP_HEALTH_URL" 2>/dev/null || curl -s --max-time 10 "$BASIC_DEEP_CHECK_URL")
    if [ -n "$DEEP_RESPONSE" ]; then
        log "Deep health response: $DEEP_RESPONSE"
    fi
else
    log "WARNING: Deep health endpoint not available, using basic health"
fi

# Финальная проверка главной страницы
log "Testing main page..."
if curl -fsS --max-time 10 "https://beachplay.ru/" > /dev/null; then
    log "✅ Main page loaded successfully"
else
    log "ERROR: Main page failed to load"
    exit 1
fi

# ============================================================================
# ФИНАЛЬНЫЙ ОТЧЕТ
# ============================================================================

log "🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!"
log "📊 Summary:"
log "  - Database: migrated with backup protection"
log "  - Static files: collected and verified" 
log "  - API endpoints: smoke tested"
log "  - Health checks: passed"
log "  - Main page: accessible"
log ""
log "🚀 Application is ready at: https://beachplay.ru"
log "💾 Latest backup: $BACKUP_FILE ($BACKUP_SIZE lines)"

# Очистка очень старых бэкапов (старше 7 дней)
find /tmp -name "sandmatch_backup_*.json" -type f -mtime +7 -delete 2>/dev/null || true
