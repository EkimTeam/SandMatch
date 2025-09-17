#!/usr/bin/env sh
set -e

python manage.py migrate --noinput
python manage.py collectstatic --noinput || true

# DEV: runserver for MVP0
python manage.py runserver 0.0.0.0:8080
