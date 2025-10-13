# План публикации BeachPlay в Yandex Cloud

## Текущее состояние
- Приложение работает локально (localhost:8000)
- Django + PostgreSQL + React (Vite)
- JWT-аутентификация реализована через `djangorestframework-simplejwt`
- Разграничение прав доступа включено (права и роли в `apps.accounts` + DRF permissions)
- Включены CORS, CSP, rate limiting (DRF throttling), HTTPS/HSTS (в prod-настройках)

## Этап 1: Подготовка к публикации (ДО деплоя)

### 1.1 Аутентификация и авторизация
**Приоритет: КРИТИЧЕСКИЙ**

- [x] JWT-аутентификация через `djangorestframework-simplejwt`
- [x] Модель `UserProfile` с ролями (`ADMIN`, `VIEWER`, `REGISTERED_USER`)
- [x] Кастомные DRF permissions на мутации (например, `IsAdminOrReadOnly`)
- [x] Страница логина в React + хранение токенов + axios-интерцепторы (авто-refresh)
- [ ] Проверка ролей на всех защищённых эндпоинтах (доп. аудит)

### 1.2 Безопасность
**Приоритет: КРИТИЧЕСКИЙ**

- [x] Переместить SECRET_KEY в переменные окружения
- [x] Настроить ALLOWED_HOSTS для продакшена
- [x] Включить HTTPS/HSTS (в prod)
- [x] Настроить CORS для фронтенда
- [x] Включить rate limiting для API (DRF throttling)
- [x] Настроить CSP (Content Security Policy)
- [ ] CSRF защита там, где требуется (для cookie-сессий; JWT не использует CSRF)

### 1.3 База данных
**Приоритет: ВЫСОКИЙ**

- [x] Создать и применить миграции для всех приложений
- [ ] Настроить резервное копирование БД
- [ ] Оптимизировать индексы для частых запросов
- [ ] Добавить `db_index=True` для полей поиска

### 1.4 Статические файлы и медиа
**Приоритет: ВЫСОКИЙ**

- [ ] Настроить `django-storages` для Yandex Object Storage
- [x] Сборка фронтенда Vite (build) + Django collectstatic для выдачи через Nginx
- [ ] Настроить CDN для статических файлов
- [ ] Оптимизировать изображения (логотипы и т.д.)

### 1.5 Производительность
**Приоритет: СРЕДНИЙ**

- [ ] Настроить Redis для кэширования
- [ ] Добавить кэширование для списка турниров
- [x] Gunicorn для Django (в docker-контейнере)
- [x] Минификация фронтенда (Vite build)
- [x] gzip/brotli на уровне Nginx

### 1.6 Мониторинг и логирование
**Приоритет: СРЕДНИЙ**

- [ ] Настроить Sentry для отслеживания ошибок
- [ ] Настроить логирование в файлы
- [ ] Добавить health check endpoint
- [ ] Настроить мониторинг через Yandex Monitoring

## Этап 2: Деплой в Yandex Cloud

### 2.1 Инфраструктура
**Сервисы Yandex Cloud:**

- [ ] **Yandex Compute Cloud** - виртуальная машина для Django
  - Ubuntu 22.04 LTS
  - 2 vCPU, 4 GB RAM (минимум)
  
- [ ] **Yandex Managed Service for PostgreSQL**
  - PostgreSQL 14+
  - Автоматические бэкапы
  
- [ ] **Yandex Object Storage (S3)**
  - Для статических файлов
  - Для медиа файлов
  
- [ ] **Yandex Application Load Balancer**
  - SSL сертификат (Let's Encrypt)
  - Балансировка нагрузки

### 2.2 Настройка сервера (Docker‑подход)

```bash
# На виртуальной машине
sudo apt update && sudo apt upgrade -y
# Установка Docker и compose plugin
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER

# (Опционально) Nginx как reverse-proxy (если не используем ALB TLS termination)
sudo apt install -y nginx

# Клонирование репозитория / или pull артефактов из CI
git clone <repo> /opt/sandmatch && cd /opt/sandmatch

# Подготовка .env
cp .env.example .env
# Обновите значения:
# SECRET_KEY=...
# DJANGO_SETTINGS_MODULE=sandmatch.settings.prod
# DATABASE_URL=postgres://user:pass@<pg_host>:5432/<db>
# ALLOWED_HOSTS=your.domain
# CORS_ALLOWED_ORIGINS=https://your.domain
# CSRF_TRUSTED_ORIGINS=https://your.domain
# SIMPLE_JWT_ACCESS_LIFETIME=3600
# SIMPLE_JWT_REFRESH_LIFETIME=2592000

# Сборка фронтенда и бэкенда (если собираем на VM)
cd frontend && npm ci && npm run build && cd ..

# Запуск через docker compose
docker compose up -d --build

# Миграции и админ
docker compose exec web python manage.py migrate --noinput
docker compose exec web python manage.py collectstatic --noinput
# docker compose exec web python manage.py createsuperuser

# Настройка Nginx (пример upstream на контейнер web:8000)
# server {
#   listen 80;
#   server_name your.domain;
#   location /static/ { alias /opt/sandmatch/static/; }
#   location / {
#     proxy_pass http://127.0.0.1:8000;
#     proxy_set_header Host $host;
#     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#     proxy_set_header X-Forwarded-Proto $scheme;
#   }
# }

# (Опционально) systemd unit для docker compose stack
# /etc/systemd/system/sandmatch.service
# [Unit]
# Description=SandMatch Stack
# Requires=docker.service
# After=docker.service
# [Service]
# Type=oneshot
# WorkingDirectory=/opt/sandmatch
# ExecStart=/usr/bin/docker compose up -d
# ExecStop=/usr/bin/docker compose down
# RemainAfterExit=yes
# [Install]
# WantedBy=multi-user.target

sudo systemctl daemon-reload
sudo systemctl enable sandmatch
sudo systemctl start sandmatch
```

### 2.3 CI/CD 

- [ ] GitHub Actions: линт/тесты + сборка фронтенда + docker build/push в Yandex Container Registry
- [ ] Автодеплой на VM (ssh + docker compose pull/up)
- [ ] Staging окружение (отдельная VM / namespace)
- [ ] Обязательные тесты перед деплоем

## Этап 3: После публикации

### 3.1 Публичный просмотр турниров
**Приоритет: ВЫСОКИЙ**

- [ ] Создать публичные endpoints без аутентификации:
  - `GET /api/tournaments/public/` - список турниров
  - `GET /api/tournaments/public/{id}/` - детали турнира
  - `GET /api/tournaments/public/{id}/results/` - результаты
- [ ] Добавить SEO мета-теги для турниров
- [ ] Создать публичную страницу турнира (share link)

### 3.2 Регистрация пользователей
**Приоритет: СРЕДНИЙ**

- [ ] Добавить форму регистрации через email
- [ ] Добавить подтверждение email
- [ ] Создать личный кабинет пользователя
- [ ] Добавить страницу статистики игрока

### 3.3 Telegram Bot
**Приоритет: ВЫСОКИЙ**

#### 3.3.1 Основной функционал бота

- [ ] Создать Telegram бота через BotFather
- [ ] Установить `python-telegram-bot` или `aiogram`
- [ ] Реализовать команды:
  - `/start` - приветствие и регистрация
  - `/tournaments` - список турниров
  - `/register {tournament_id}` - запись на турнир
  - `/mystats` - статистика пользователя
  - `/link {code}` - привязка к аккаунту в БД

#### 3.3.2 Модель данных

```python
# apps/players/models.py
class Player:
    telegram_id = models.BigIntegerField(null=True, blank=True, unique=True)
    telegram_username = models.CharField(max_length=100, null=True, blank=True)
    
class TournamentRegistration:
    tournament = models.ForeignKey(Tournament)
    player = models.ForeignKey(Player)
    registered_via = models.CharField(choices=['web', 'telegram'])
    registered_at = models.DateTimeField(auto_now_add=True)
```

#### 3.3.3 Уведомления

- [ ] Новый турнир создан (для подписчиков)
- [ ] Турнир начнется через 24 часа
- [ ] Турнир начнется через 1 час
- [ ] Ваш матч начнется через 30 минут (опционально)
- [ ] Результаты турнира опубликованы

#### 3.3.4 Webhook для бота

- [ ] Настроить webhook на `https://yourdomain.ru/api/telegram/webhook/`
- [ ] Создать endpoint для обработки сообщений от Telegram
- [ ] Настроить очередь задач (Celery + Redis) для отправки уведомлений

### 3.4 Telegram Mini App
**Приоритет: СРЕДНИЙ**

- [ ] Создать отдельное React приложение для Mini App
- [ ] Использовать Telegram WebApp API
- [ ] Реализовать функционал:
  - Просмотр списка турниров
  - Просмотр результатов турнира
  - Просмотр статистики игрока
  - Запись на турнир
- [ ] Настроить аутентификацию через Telegram initData
- [ ] Деплой Mini App на отдельный поддомен (miniapp.yourdomain.ru)

## Этап 4: Дополнительные улучшения

### 4.1 Аналитика
- [ ] Google Analytics или Yandex.Metrica
- [ ] Отслеживание популярных турниров
- [ ] Статистика использования бота

### 4.2 Производительность
- [ ] Настроить CDN для фронтенда
- [ ] Добавить Service Worker для PWA
- [ ] Оптимизировать SQL запросы (select_related, prefetch_related)

### 4.3 Резервное копирование
- [ ] Автоматические бэкапы БД (ежедневно)
- [ ] Бэкапы в Yandex Object Storage
- [ ] План восстановления после сбоя

## Оценка сроков

### Критический путь (до первой публикации):
- Аутентификация и безопасность: **выполнено базово** (остался аудит ролей) — **1-2 дня**
- Настройка инфраструктуры Yandex Cloud: **3-5 дней**
- Деплой и тестирование: **2-3 дня**
- **ИТОГО: 6-10 дней**

### После публикации:
- Публичный просмотр: **3-5 дней**
- Telegram Bot (базовый): **7-10 дней**
- Telegram Mini App: **10-14 дней**
- Система уведомлений: **5-7 дней**
- **ИТОГО: 25-36 дней**

## Стоимость Yandex Cloud (примерная)

- Compute Cloud (VM): ~1500₽/месяц
- Managed PostgreSQL: ~2000₽/месяц
- Object Storage: ~100₽/месяц (за 10GB)
- Load Balancer: ~800₽/месяц
- **ИТОГО: ~4500₽/месяц**

## Риски и митигация

1. **Риск**: Потеря данных при миграции
   - **Митигация**: Полный бэкап перед деплоем, тестирование на staging

2. **Риск**: Проблемы с производительностью под нагрузкой
   - **Митигация**: Load testing, кэширование, масштабирование VM

3. **Риск**: Уязвимости безопасности
   - **Митигация**: Security audit, регулярные обновления, мониторинг

4. **Риск**: Сложности с интеграцией Telegram
   - **Митигация**: Поэтапная разработка, тестирование на тестовом боте

## Следующие шаги

1. Утвердить план с заказчиком
2. Создать аккаунт в Yandex Cloud
3. Провести аудит ролей и прав на эндпоинтах (Этап 1.1)
4. Подготовить инфраструктуру (Этап 2.1) и CI/CD (Этап 2.3)
5. Настроить Object Storage или локальную раздачу статики через Nginx
