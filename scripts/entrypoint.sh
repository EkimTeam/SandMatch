#!/usr/bin/env sh
set -e

# Миграции и сбор статики
python manage.py migrate --noinput

# Синхронизация Vite-ассетов в проде: если /app/static/frontend пусто или отсутствует,
# копируем из собранного каталога /app/frontend/dist (скопированного в образ на этапе сборки)
ASSETS_SRC="/app/frontend/dist"
ASSETS_DST="/app/static/frontend"
if [ -d "$ASSETS_SRC" ]; then
  if [ ! -d "$ASSETS_DST" ] || [ -z "$(ls -A "$ASSETS_DST" 2>/dev/null)" ]; then
    echo "[entrypoint] Пополняю статические файлы фронтенда: $ASSETS_SRC → $ASSETS_DST"
    mkdir -p "$ASSETS_DST"
    cp -r "$ASSETS_SRC"/. "$ASSETS_DST"/
  else
    echo "[entrypoint] Vite-ассеты уже присутствуют в $ASSETS_DST — пропускаю копирование"
  fi
else
  echo "[entrypoint] Внимание: не найден каталог собранных ассетов $ASSETS_SRC"
fi

python manage.py collectstatic --noinput || true

# PROD: gunicorn (WSGI)
exec gunicorn sandmatch.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-60}"
