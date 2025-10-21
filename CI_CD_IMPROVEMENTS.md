# План улучшения CI/CD для SandMatch

## Дата создания: 2025-10-21
## Статус: В работе

---

## 🔥 КРИТИЧЕСКИЕ ПРОБЛЕМЫ (исправить немедленно)

### ✅ 1. Добавить base path в vite.config.ts
**Проблема:** Vite генерирует пути `/assets/...`, но Django раздаёт из `/static/frontend/`  
**Последствия:** 404 на все JS/CSS файлы в продакшене  
**Решение:** Добавить `base: '/static/frontend/'` в build config  
**Файлы:** `frontend/vite.config.ts`  
**Статус:** ✅ ВЫПОЛНЕНО

---

### ✅ 2. Создать Django integration для Vite manifest
**Проблема:** Шаблон spa.html использует `vite_assets`, но нет кода для чтения manifest.json  
**Последствия:** Django не знает какие хешированные файлы загружать  
**Решение:** Создать template tag для парсинга manifest.json  
**Файлы:** 
- `apps/core/templatetags/vite_assets.py` (создано)
- `apps/core/__init__.py` (создано)
- `apps/core/apps.py` (создано)
- `templates/spa.html` (обновлено)
- `templates/vite_assets_tags.html` (создано)
- `sandmatch/settings/base.py` (добавлено apps.core в INSTALLED_APPS)  
**Статус:** ✅ ВЫПОЛНЕНО

---

### ✅ 3. Добавить Nginx reverse proxy
**Проблема:** Gunicorn раздаёт статику напрямую (неэффективно)  
**Последствия:** Медленная загрузка, нет gzip, нет HTTP/2, траты worker'ов  
**Решение:** Добавить Nginx для раздачи статики и проксирования к Gunicorn  
**Файлы:**
- `nginx/nginx.conf` (создан с gzip, кэшированием, оптимизацией)
- `docker-compose.prod.yml` (добавлен nginx service с healthcheck)
- `Dockerfile.nginx` (создан)
- `deploy/deploy.sh` (обновлён для сборки nginx)  
**Статус:** ✅ ВЫПОЛНЕНО

---

### ✅ 4. Исправить static files mapping
**Проблема:** Конфликт между static/, staticfiles/ и копированием ассетов  
**Последствия:** Django может не найти фронтенд ассеты  
**Решение:** Унифицировать путь: копировать в staticfiles/frontend/, убрать дублирование  
**Файлы:**
- `scripts/entrypoint.sh` (изменён ASSETS_DST на /app/staticfiles/frontend)
- `docker-compose.prod.yml` (обновлён volume mount на ./staticfiles)
- `deploy/deploy.sh` (обновлён путь очистки ассетов)  
**Статус:** ✅ ВЫПОЛНЕНО

---

## ⚠️ ВАЖНЫЕ УЛУЧШЕНИЯ (в течение недели)

### ⏳ 5. Добавить frontend тесты в CI
**Проблема:** Нет unit/e2e тестов, нет type checking  
**Решение:** 
- Добавить `npm run test` в ci.yml
- Добавить `tsc --noEmit` для проверки типов
- Настроить Vitest или Jest  
**Файлы:** `.github/workflows/ci.yml`, `frontend/package.json`  
**Статус:** ⏳ Ожидает выполнения

---

### ⏳ 6. Включить кэширование node_modules
**Проблема:** Каждый CI прогон устанавливает 200MB зависимостей (2-3 мин)  
**Решение:** Включить `cache: 'npm'` в setup-node action  
**Файлы:** `.github/workflows/ci.yml`  
**Статус:** ⏳ Ожидает выполнения

---

### ⏳ 7. Реализовать rollback механизм
**Проблема:** При падении деплоя нет автоотката  
**Решение:** 
- Сохранять предыдущий образ с тегом `previous`
- При падении health check откатываться на previous
- Добавить команду `./deploy.sh rollback`  
**Файлы:** `deploy/deploy.sh`  
**Статус:** ⏳ Ожидает выполнения

---

### ⏳ 8. Улучшить health check в deploy
**Проблема:** Race condition между up -d и готовностью ассетов  
**Решение:** 
- Добавить readiness probe в Docker
- Проверять не только /api/health/, но и наличие frontend ассетов
- Использовать zero-downtime deployment (blue-green)  
**Файлы:** `deploy/deploy.sh`, `docker-compose.prod.yml`  
**Статус:** ⏳ Ожидает выполнения

---

## 📊 ЖЕЛАТЕЛЬНЫЕ УЛУЧШЕНИЯ (в течение месяца)

### ⏳ 9. Bundle size monitoring
**Решение:** Добавить bundlesize или size-limit в CI  
**Статус:** ⏳ Ожидает выполнения

---

### ⏳ 10. Lighthouse CI для performance
**Решение:** Добавить @lhci/cli для проверки метрик производительности  
**Статус:** ⏳ Ожидает выполнения

---

### ⏳ 11. Dependency scanning
**Решение:** Включить Dependabot или Renovate для автообновления зависимостей  
**Статус:** ⏳ Ожидает выполнения

---

### ⏳ 12. Staging environment
**Решение:** Создать staging окружение для тестирования перед продом  
**Статус:** ⏳ Ожидает выполнения

---

## 📝 ДОПОЛНИТЕЛЬНЫЕ НАХОДКИ

### ⚠️ Проблема: Lint в CI не блокирует сборку
```yaml
- name: Frontend lint (non-blocking)
  continue-on-error: true  # ❌ Плохая практика
```
**Решение:** Убрать `continue-on-error` после исправления всех lint ошибок

---

### ⚠️ Проблема: Django check не блокирует CI
```yaml
python manage.py check --deploy --fail-level WARNING || true  # ❌ || true игнорирует ошибки
```
**Решение:** Убрать `|| true` после исправления всех предупреждений

---

### ⚠️ Проблема: Отсутствует .nvmrc
**Решение:** Добавить `.nvmrc` с версией Node.js для консистентности между dev/CI/prod

---

### ⚠️ Проблема: package-lock.json в .gitignore
```gitignore
frontend/package-lock.json  # ❌ Должен быть в репозитории!
```
**Решение:** Убрать из .gitignore для детерминированных сборок

---

## 🎯 ПОРЯДОК ВЫПОЛНЕНИЯ

1. ✅ Создать этот план
2. ✅ Исправить vite.config.ts (base path)
3. ✅ Создать Django template tag для manifest
4. ✅ Исправить static files mapping
5. ✅ Добавить Nginx
6. ⏳ Тестирование критических исправлений
7. ⏳ Остальные улучшения по приоритету

---

## 📌 ПРИМЕЧАНИЯ

- Все изменения должны быть обратно совместимы с dev окружением
- После каждого критического исправления - тестирование
- Документировать все изменения в README.md
- Обновлять DEPLOYMENT_PLAN.md при необходимости
