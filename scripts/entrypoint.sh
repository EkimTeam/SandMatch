#!/usr/bin/env sh
set -e

# Миграции и сбор статики
python manage.py migrate --noinput

# Синхронизация Vite-ассетов в проде: копируем из /app/frontend/dist в staticfiles/frontend
# Это должно происходить ДО collectstatic, чтобы Django мог их подхватить
ASSETS_SRC="/app/frontend/dist"
ASSETS_DST="/app/staticfiles/frontend"

# Всегда копируем свежие ассеты при старте контейнера
if [ -d "$ASSETS_SRC" ]; then
  echo "[entrypoint] Копирую Vite-ассеты: $ASSETS_SRC → $ASSETS_DST"
  mkdir -p "$ASSETS_DST"
  # Очищаем старые ассеты и копируем новые
  rm -rf "$ASSETS_DST"/* 2>/dev/null || true
  cp -r "$ASSETS_SRC"/. "$ASSETS_DST"/
  echo "[entrypoint] Vite-ассеты успешно скопированы"
else
  echo "[entrypoint] ВНИМАНИЕ: не найден каталог собранных ассетов $ASSETS_SRC. Продолжаю запуск без копирования."
fi

# Собираем остальную статику (admin, etc)
python manage.py collectstatic --noinput || true

# PROD: gunicorn (WSGI)
echo "[entrypoint] Запуск gunicorn..."
exec gunicorn sandmatch.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-60}"
