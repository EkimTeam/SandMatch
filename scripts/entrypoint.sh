#!/usr/bin/env sh
set -e

# Миграции и сбор статики
python manage.py migrate --noinput

# Синхронизация Vite-ассетов в проде: если /app/static/frontend пусто или отсутствует,
# копируем из собранного каталога /app/frontend/dist (скопированного в образ на этапе сборки)
ASSETS_SRC="/app/frontend/dist"
ASSETS_DST="/app/static/frontend"

if [ -d "$ASSETS_SRC" ]; then
  echo "[entrypoint] Синхронизация статических файлов фронтенда: $ASSETS_SRC → $ASSETS_DST"
  mkdir -p "$ASSETS_DST"
  cp -r "$ASSETS_SRC"/. "$ASSETS_DST"/
else
  # Источник отсутствует — это потенциальная проблема
  echo "[entrypoint] Внимание: не найден каталог собранных ассетов $ASSETS_SRC"
fi

python manage.py collectstatic --noinput || true

if [ "${RUN_TELEGRAM_BOT:-}" = "true" ]; then
  exec python manage.py run_bot
fi

if [ "${RUN_CELERY_WORKER:-}" = "true" ]; then
  exec celery -A sandmatch worker -l info
fi

if [ "${RUN_CELERY_BEAT:-}" = "true" ]; then
  exec celery -A sandmatch beat -l info
fi

exec gunicorn sandmatch.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-60}"
