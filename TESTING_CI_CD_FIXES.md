# Инструкции по тестированию исправлений CI/CD

## Дата: 2025-10-21

---

## ✅ ЧТО БЫЛО ИСПРАВЛЕНО

### 1. **Vite base path** (`frontend/vite.config.ts`)
- Добавлен `base: '/static/frontend/'` для корректной генерации путей в продакшене

### 2. **Django integration для Vite manifest**
- Создано приложение `apps.core` с template tags
- `apps/core/templatetags/vite_assets.py` - парсинг manifest.json
- `templates/spa.html` - обновлён для использования новых template tags
- `templates/vite_assets_tags.html` - HMR client для dev режима

### 3. **Static files mapping**
- `scripts/entrypoint.sh` - ассеты копируются в `/app/staticfiles/frontend`
- `docker-compose.prod.yml` - volume mount изменён на `./staticfiles`
- `deploy/deploy.sh` - обновлён путь очистки ассетов

### 4. **Nginx reverse proxy**
- `nginx/nginx.conf` - конфигурация с gzip, кэшированием, оптимизацией
- `Dockerfile.nginx` - образ Nginx
- `docker-compose.prod.yml` - добавлен nginx service с healthcheck
- Порт приложения остаётся 8000 (Nginx слушает на 8000, проксирует на web:8000)

---

## 🧪 ПЛАН ТЕСТИРОВАНИЯ

### Этап 1: Локальная сборка фронтенда

```bash
cd frontend
npm install
npm run build
```

**Проверить:**
- ✅ Сборка завершается без ошибок
- ✅ В `frontend/dist/` появился `manifest.json`
- ✅ В manifest.json пути начинаются с `/static/frontend/`
- ✅ Файлы в `frontend/dist/assets/` имеют хеши в именах

---

### Этап 2: Локальная сборка Docker образа

```bash
# Из корня проекта
docker build -t sandmatch-test:local .
```

**Проверить:**
- ✅ Stage 1 (frontend-builder) успешно собирает фронтенд
- ✅ Stage 2 (runtime) копирует ассеты из builder
- ✅ Образ создан успешно

**Проверить содержимое образа:**
```bash
docker run --rm sandmatch-test:local ls -la /app/frontend/dist/
docker run --rm sandmatch-test:local cat /app/frontend/dist/manifest.json
```

---

### Этап 3: Запуск с docker-compose (dev режим)

```bash
# Убедитесь что .env настроен для dev
docker compose up --build
```

**Проверить:**
- ✅ Контейнер web запускается
- ✅ Миграции применяются
- ✅ Ассеты копируются в `/app/staticfiles/frontend`
- ✅ collectstatic выполняется
- ✅ Gunicorn запускается на порту 8000

**Проверить логи:**
```bash
docker compose logs web | grep "entrypoint"
```

Должны быть строки:
```
[entrypoint] Копирую Vite-ассеты: /app/frontend/dist → /app/staticfiles/frontend
[entrypoint] Vite-ассеты успешно скопированы
```

---

### Этап 4: Проверка Django template tags

```bash
# Войти в контейнер
docker compose exec web python manage.py shell
```

```python
from django.template import Template, Context
from django.conf import settings

# Проверить что apps.core в INSTALLED_APPS
print('apps.core' in settings.INSTALLED_APPS)  # Должно быть True

# Проверить загрузку template tag
from apps.core.templatetags import vite_assets
print(dir(vite_assets))  # Должны быть vite_asset, vite_css_assets, vite_hmr_client

# Проверить парсинг manifest (если в prod режиме)
if not settings.DEBUG:
    manifest = vite_assets._load_vite_manifest()
    print(manifest.keys())  # Должен быть 'src/main.tsx'
```

---

### Этап 5: Тестирование с Nginx (prod режим)

```bash
# Создать .env для prod режима
cp .env.example .env
# Установить DJANGO_DEBUG=0

# Запустить prod compose
docker compose -f docker-compose.prod.yml up --build
```

**Проверить:**
- ✅ Контейнер web запускается и становится healthy
- ✅ Контейнер nginx запускается после web
- ✅ Nginx доступен на порту 8080

**Проверить endpoints:**
```bash
# Health check через Nginx
curl -I http://localhost:8000/api/health/

# Статика через Nginx
curl -I http://localhost:8000/static/img/logo.png

# Frontend assets через Nginx (замените хеш на актуальный из manifest.json)
curl -I http://localhost:8000/static/frontend/assets/index-HASH.js

# Главная страница (SPA)
curl -I http://localhost:8000/
```

**Все ответы должны быть 200 OK**

---

### Этап 6: Проверка в браузере

Откройте http://localhost:8000/

**Проверить в DevTools:**
1. **Network tab:**
   - ✅ Все JS/CSS файлы загружаются (200 OK)
   - ✅ Пути начинаются с `/static/frontend/`
   - ✅ Файлы имеют хеши в именах
   - ✅ Response headers содержат `Cache-Control: public, immutable`
   - ✅ Response headers содержат `Content-Encoding: gzip`

2. **Console tab:**
   - ✅ Нет ошибок 404
   - ✅ React приложение загружается
   - ✅ Нет ошибок в консоли

3. **Application tab:**
   - ✅ Проверить что root элемент заполнен React компонентами

---

### Этап 7: Проверка CI/CD pipeline

```bash
# Симуляция CI build
cd frontend
npm ci --no-audit --no-fund --prefer-offline
npm run build

# Проверка что сборка работает как в CI
cd ..
docker build -t sandmatch-ci-test .
```

**Проверить:**
- ✅ npm ci устанавливает зависимости
- ✅ npm run build успешно собирает фронтенд
- ✅ Docker build завершается успешно

---

## 🐛 ИЗВЕСТНЫЕ ПРОБЛЕМЫ И РЕШЕНИЯ

### Проблема 1: "Module not found" при загрузке template tag
**Решение:** Убедитесь что `apps.core` добавлен в INSTALLED_APPS перед использованием

### Проблема 2: 404 на frontend assets
**Решение:** 
1. Проверьте что manifest.json существует в staticfiles/frontend/
2. Проверьте что пути в manifest начинаются с правильного base
3. Проверьте логи entrypoint.sh на наличие ошибок копирования

### Проблема 3: Nginx не может подключиться к web
**Решение:**
1. Проверьте что web service healthy: `docker compose ps`
2. Проверьте логи: `docker compose logs web`
3. Увеличьте start_period в healthcheck если нужно

### Проблема 4: Старые ассеты кэшируются
**Решение:**
1. Очистите ./staticfiles/frontend/ на хосте
2. Пересоберите образ: `docker compose build --no-cache`
3. Очистите кэш браузера (Ctrl+Shift+R)

---

## 📋 ЧЕКЛИСТ ПЕРЕД ДЕПЛОЕМ В ПРОД

- [ ] Все тесты из этапов 1-7 пройдены
- [ ] Frontend собирается без ошибок
- [ ] Docker образ собирается без ошибок
- [ ] Nginx корректно раздаёт статику
- [ ] Health checks проходят
- [ ] В браузере нет 404 ошибок
- [ ] React приложение загружается и работает
- [ ] Gzip compression работает
- [ ] Cache headers установлены корректно
- [ ] Обновлён .env на проде (DJANGO_DEBUG=0)
- [ ] Обновлены переменные в GitHub Secrets если нужно

---

## 🚀 ДЕПЛОЙ В ПРОД

После успешного прохождения всех тестов:

```bash
# Закоммитить изменения
git add .
git commit -m "fix: критические исправления CI/CD для фронтенда"
git push origin main

# CI/CD автоматически:
# 1. Соберёт фронтенд
# 2. Соберёт Docker образ
# 3. Запушит в GHCR
# 4. Задеплоит на сервер через SSH
# 5. Запустит health check
```

**Мониторить:**
- GitHub Actions workflow
- Логи на сервере: `ssh user@server "cd /opt/sandmatch/app && docker compose logs -f"`
- Health check endpoint: `curl https://your-domain.com/api/health/`

---

## 📞 ПОДДЕРЖКА

Если возникли проблемы:
1. Проверьте логи: `docker compose logs`
2. Проверьте health status: `docker compose ps`
3. Проверьте содержимое staticfiles: `docker compose exec web ls -la /app/staticfiles/frontend/`
4. Обратитесь к CI_CD_IMPROVEMENTS.md для деталей изменений
