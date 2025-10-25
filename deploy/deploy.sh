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
    find /tmp -maxdepth 1 -name "sandmatch_backup_*.json" -type f | sort -r | tail -n +6 | xargs rm -f -- 2>/dev/null || true
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

# Сборка статики Django (без удаления уже существующих Vite-ассетов)
log "Collecting Django static files (no --clear)..."
docker compose exec -T web python manage.py collectstatic --noinput

# Страховка: убедиться, что Vite-ассеты присутствуют после collectstatic
# Бывали случаи, когда при использовании --clear стирались файлы frontend/*.
# Здесь мы явно докопируем их из образа в STATIC_ROOT внутри контейнера.
log "Ensuring Vite assets exist in STATIC_ROOT after collectstatic..."
docker compose exec -T web /bin/sh -lc '
  set -e
  SRC="/app/frontend/dist"
  DST="/app/static/frontend"
  if [ -d "$SRC" ]; then
    mkdir -p "$DST"
    cp -r "$SRC"/. "$DST"/
    echo "[deploy] Vite assets synced: $SRC -> $DST"
  else
    echo "[deploy] WARNING: Vite build folder not found at $SRC"
  fi
'

# Синхронизировать всю статику из контейнера на хост для Nginx (включая frontend/, admin/, rest_framework/, img/)
log "Syncing STATIC_ROOT from container -> host (./static)..."
mkdir -p static || true
docker compose cp web:/app/static/. ./static/ || true
# Проставим максимально совместимые права (r-x для мира)
sudo chown -R root:root static/ 2>/dev/null || true
sudo find static -type d -exec chmod 755 {} + 2>/dev/null || true
sudo find static -type f -exec chmod 644 {} + 2>/dev/null || true
log "Static files are available on host at $(pwd)/static"

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
        log "Detailed response:"
        curl -v "$SMOKE_URL" --max-time 5 2>&1 | head -20 || true
        exit 1
    fi
    log "✅ API $endpoint: HTTP $RESPONSE_CODE"
done

# Проверка статики на основе manifest.json
log "Testing static files from manifest.json..."
HOST_STATIC_DIR="/opt/sandmatch/app/static/frontend"
MANIFEST_PATH="$HOST_STATIC_DIR/manifest.json"

if [ ! -f "$MANIFEST_PATH" ]; then
  log "ERROR: manifest.json not found at $MANIFEST_PATH"
  ls -la "$HOST_STATIC_DIR" || true
  exit 1
fi

# Парсим manifest.json через Python (без зависимости от jq)
log "Extracting asset paths from manifest..."
ASSETS_CHECK=$(python3 <<EOF
import json
import sys

try:
    with open("$MANIFEST_PATH", "r") as f:
        manifest = json.load(f)
    
    # Ищем entry для src/main.tsx
    entry = manifest.get("src/main.tsx", {})
    files = []
    
    # Добавляем основной JS файл
    if "file" in entry:
        files.append(entry["file"])
    
    # Добавляем CSS файлы
    if "css" in entry:
        files.extend(entry["css"])
    
    if not files:
        print("ERROR: No files found in manifest entry src/main.tsx", file=sys.stderr)
        sys.exit(1)
    
    # Выводим список файлов для проверки
    for f in files:
        print(f)
    
except Exception as e:
    print(f"ERROR: Failed to parse manifest: {e}", file=sys.stderr)
    sys.exit(1)
EOF
)

if [ $? -ne 0 ]; then
  log "$ASSETS_CHECK"
  exit 1
fi

# Проверяем доступность каждого файла
while IFS= read -r relpath; do
  [ -z "$relpath" ] && continue
  URL="https://beachplay.ru/static/frontend/${relpath}"
  if curl -fsS --max-time 10 "$URL" > /dev/null; then
    log "✅ Static file accessible: $URL"
  else
    log "ERROR: Static file not accessible: $URL"
    exit 1
  fi
done <<< "$ASSETS_CHECK"

# Проверка логотипа
LOGO_URL="https://beachplay.ru/static/img/logo.png"
if curl -fsS --max-time 10 "$LOGO_URL" > /dev/null; then
  log "✅ Logo accessible: $LOGO_URL"
else
  log "ERROR: Logo not accessible: $LOGO_URL"
  ls -la /opt/sandmatch/app/static/img/ || true
  exit 1
fi

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
