## Stage 1: build frontend with Node (Vite)
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

## Stage 2: Python runtime
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on

WORKDIR /app

COPY requirements.txt /app/
RUN pip install -r requirements.txt

# Copy project sources
COPY . /app

# Copy built frontend assets into Django static tree
RUN mkdir -p /app/static/frontend \
 && cp -r /app/frontend/dist/* /app/static/frontend/ || true

# Ensure entrypoint is executable
RUN chmod +x /app/scripts/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
