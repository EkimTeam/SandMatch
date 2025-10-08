#!/usr/bin/env sh
set -e

# Миграции и сбор статики
python manage.py migrate --noinput
python manage.py collectstatic --noinput || true

# PROD: gunicorn (WSGI)
exec gunicorn sandmatch.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "${GUNICORN_WORKERS:-3}" \
  --timeout "${GUNICORN_TIMEOUT:-60}"
