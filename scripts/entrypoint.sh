#!/usr/bin/env sh
set -e

# Миграции и сбор статики
python manage.py migrate --noinput

# Синхронизация Vite-ассетов в проде: если /app/static/frontend пусто или отсутствует,
# копируем из собранного каталога /app/frontend/dist (скопированного в образ на этапе сборки)
ASSETS_SRC="/app/frontend/dist"
ASSETS_DST="/app/static/frontend"

# Если назначения уже есть и не пусто — ничего не делаем и не предупреждаем
if [ -d "$ASSETS_DST" ] && [ -n "$(ls -A "$ASSETS_DST" 2>/dev/null)" ]; then
  echo "[entrypoint] Vite-ассеты уже присутствуют в $ASSETS_DST — пропускаю копирование"
else
  if [ -d "$ASSETS_SRC" ]; then
    echo "[entrypoint] Пополняю статические файлы фронтенда: $ASSETS_SRC → $ASSETS_DST"
    mkdir -p "$ASSETS_DST"
    cp -r "$ASSETS_SRC"/. "$ASSETS_DST"/
  else
    # Источник отсутствует и назначение пустое — это потенциальная проблема
    echo "[entrypoint] Внимание: не найден каталог собранных ассетов $ASSETS_SRC и папка назначения пуста ($ASSETS_DST)"
  fi
fi

python manage.py collectstatic --noinput || true

# PROD: gunicorn (WSGI)
exec gunicorn sandmatch.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-60}"
