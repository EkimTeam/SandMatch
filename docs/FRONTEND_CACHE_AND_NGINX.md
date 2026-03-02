---
# FRONTEND_CACHE_AND_NGINX

## Где лежат nginx-настройки для SandMatch

- Основной конфиг nginx на проде: `/etc/nginx/nginx.conf` (стандартный).
- Конфиг сайта SandMatch:
  - `/etc/nginx/sites-available/sandmatch`
  - активная ссылка: `/etc/nginx/sites-enabled/sandmatch`.
- Именно в файле `sandmatch` находятся блоки `server { ... }` для доменов `beachplay.ru`, `www.beachplay.ru`, `beachplay.online`, `www.beachplay.online`.

## Как проксируется приложение

- HTTP → HTTPS редирект:
  - отдельный `server` на `listen 80`, который делает `return 301 https://$host$request_uri;`.
- Основной HTTPS-блок:
  - `listen 443 ssl;`
  - `server_name beachplay.ru www.beachplay.ru beachplay.online www.beachplay.online;`
  - SSL-сертификаты от Certbot: `fullchain.pem`, `privkey.pem`.
- Проксирование API и SPA на Django в Docker:
  - `location /api/ { proxy_pass http://127.0.0.1:8000; ... }`
  - `location / { proxy_pass http://127.0.0.1:8000; ... }`

## Раздача статики и медиа

- Статика Django/фронт:
  - `location /static/ { alias /opt/sandmatch/app/static/; access_log off; }`
  - Внутри этого каталога лежат Vite-ассеты фронтенда: `/static/frontend/...`.
- Медиа:
  - `location /media/ { alias /opt/sandmatch/app/media/; access_log off; }`

## Политика кеширования фронтенда

### JS/CSS/ассеты (Vite, hashed bundles)

- Файлы типа `main-<hash>.js`, `assets/*.css` и т.п. раздаются nginx из `/static/frontend/`.
- Для `location /static/` установлены заголовки:

  ```nginx
  location /static/ {
      alias /opt/sandmatch/app/static/;
      access_log off;
      add_header Cache-Control "public, max-age=31536000, immutable";
  }
  ```

- Это означает:
  - браузер может кешировать такие файлы до года (`max-age=31536000`);
  - флаг `immutable` говорит, что содержимое по этому URL меняться не будет;
  - при новом билде Vite меняет имя файла (включает новый hash), поэтому клиенты автоматически получают новую версию.

### HTML/SPA-страницы

- Все остальные запросы (включая `"/"` и роуты SPA) идут через `location /` на Django:

  ```nginx
  location / {
      proxy_pass http://127.0.0.1:8000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-Host $host;

      # HTML/SPA не кешируем, чтобы всегда подтягивать актуальный manifest и бандлы
      add_header Cache-Control "no-cache, must-revalidate";
  }
  ```

- Это гарантирует, что:
  - браузер всегда проверяет у сервера, нет ли новой версии HTML;
  - HTML отдаёт ссылки на актуальные `main-<hash>.js`/CSS;
  - даже на мобильных/планшетах после деплоя пользователи увидят свежую версию без ручной чистки кеша.

## Связка Docker → статика → nginx

- Docker-компоуз для продакшена: `docker-compose.prod.yml`.
- Web-контейнер монтирует volume со статикой:

  ```yaml
  services:
    web:
      image: ghcr.io/ekimteam/sandmatch/web:...
      ports:
        - "8000:8000"
      volumes:
        - ./static:/app/static
  ```

- Точка входа web-контейнера: `scripts/entrypoint.sh`.
- Внутри entrypoint при старте контейнера выполняется синхронизация Vite-ассетов:

  ```sh
  ASSETS_SRC="/app/frontend/dist"
  ASSETS_DST="/app/static/frontend"

  if [ -d "$ASSETS_SRC" ]; then
    echo "[entrypoint] Синхронизация статических файлов фронтенда: $ASSETS_SRC → $ASSETS_DST"
    mkdir -p "$ASSETS_DST"
    cp -r "$ASSETS_SRC"/. "$ASSETS_DST"/
  else
    echo "[entrypoint] Внимание: не найден каталог собранных ассетов $ASSETS_SRC"
  fi
  ```

- Важно:
  - volume `./static` на хосте переживает перезапуски контейнеров;
  - каждый запуск нового образа копирует в него свежие Vite-ассеты и `manifest.json`;
  - nginx продолжает раздавать статику из этого каталога с корректными заголовками кеширования.

## Как быстро вспомнить, где править настройки

- **nginx-конфиг сайта:** `/etc/nginx/sites-enabled/sandmatch` (на прод-сервере).
- **Docker-компоуз прод:** `docker-compose.prod.yml` (в корне репозитория).
- **Точка входа web-контейнера:** `scripts/entrypoint.sh`.
- **Шаблон SPA и подключение Vite-ассетов:** `templates/spa.html`, `sandmatch/vite.py`.

При отладке кеша на клиенте полезно:

- Проверять заголовки в DevTools → Network для:
  - `main-*.js` (ожидать `Cache-Control: public, max-age=31536000, immutable`),
  - корневого HTML/SPA-роута (ожидать `Cache-Control: no-cache, must-revalidate`).
