## Stage 1: build frontend with Node (Vite)
FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
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

# Playwright/Chromium + Cyrillic fonts for correct HTML/CSS -> PDF rendering
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-dejavu-core \
    fonts-noto-core \
 && rm -rf /var/lib/apt/lists/*

RUN python -m playwright install --with-deps chromium

# Copy project sources
COPY . /app

# Copy built frontend assets from builder stage into /app/frontend/dist
# (entrypoint.sh will copy them to /app/static/frontend at container start)
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Ensure entrypoint has LF endings and is executable (fix CRLF from Windows)
RUN sed -i 's/\r$//' /app/scripts/entrypoint.sh \
 && chmod +x /app/scripts/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
