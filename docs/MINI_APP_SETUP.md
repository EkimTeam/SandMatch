# Установка и запуск Telegram Mini App

## ✅ Что уже сделано

### Backend (100%)
- ✅ API эндпоинты для турниров, профиля, регистрации
- ✅ Аутентификация через Telegram Web App initData
- ✅ Web App кнопки в боте

### Frontend (100%)
- ✅ Все страницы Mini App созданы
- ✅ Интеграция с Telegram SDK
- ✅ Роутинг настроен
- ✅ API клиент готов

---

## Установка зависимостей

### 1. Установить npm пакеты

```bash
cd frontend
npm install
```

Это установит `@twa-dev/sdk` и другие зависимости.

### 2. Проверить .env файл

Убедись, что в корне проекта есть `.env` с:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
WEB_APP_URL=http://localhost:8080
```

---

## Локальное тестирование

### Вариант 1: Через ngrok (рекомендуется)

Telegram не может открыть `localhost`, поэтому нужен туннель.

#### 1. Установить ngrok

```bash
# Windows (через Chocolatey)
choco install ngrok

# Или скачать с https://ngrok.com/download
```

#### 2. Запустить приложение

```bash
# Терминал 1: Backend
docker-compose up

# Терминал 2: Frontend
cd frontend
npm run dev
```

#### 3. Запустить ngrok

```bash
# Терминал 3: ngrok для фронтенда
ngrok http 5173
```

Ngrok выдаст URL типа: `https://abc123.ngrok.io`

#### 4. Обновить WEB_APP_URL

В `.env`:
```env
WEB_APP_URL=https://abc123.ngrok.io
```

Перезапусти бота:
```bash
docker-compose restart web
```

#### 5. Настроить в BotFather

Открой [@BotFather](https://t.me/BotFather):

```
/mybots
→ Выбери своего бота
→ Bot Settings
→ Menu Button
→ Configure menu button
→ Send URL: https://abc123.ngrok.io/mini-app/
→ Send Button text: Открыть BeachPlay
```

#### 6. Тестировать

1. Открой своего бота в Telegram
2. Нажми `/start`
3. Нажми кнопку "🏐 Открыть BeachPlay"
4. Mini App должно открыться!

---

### Вариант 2: Без ngrok (только для разработки UI)

Если хочешь просто посмотреть UI без Telegram:

```bash
cd frontend
npm run dev
```

Открой в браузере: `http://localhost:5173/mini-app/`

**⚠️ Внимание:** API запросы не будут работать, т.к. нет Telegram initData.

---

## Production деплой

### 1. Собрать фронтенд

```bash
cd frontend
npm run build
```

Файлы будут в `frontend/dist/`

### 2. Настроить Nginx/Apache

Добавь в конфиг веб-сервера:

```nginx
# Nginx
location /mini-app/ {
    alias /path/to/frontend/dist/;
    try_files $uri $uri/ /index.html;
}
```

### 3. Обновить WEB_APP_URL

В production `.env`:
```env
WEB_APP_URL=https://beachplay.ru
```

### 4. Настроить в BotFather

```
Menu Button URL: https://beachplay.ru/mini-app/
```

### 5. Подтвердить домен

BotFather попросит подтвердить домен. Следуй инструкциям.

---

## Структура проекта

```
frontend/src/
├── pages/MiniApp/
│   ├── MiniAppLayout.tsx          # Layout с Telegram SDK
│   ├── MiniAppHome.tsx            # Главная страница
│   ├── MiniAppTournaments.tsx     # Список турниров
│   ├── MiniAppTournamentDetail.tsx # Детали турнира
│   ├── MiniAppProfile.tsx         # Профиль
│   └── MiniAppMyTournaments.tsx   # Мои турниры
├── api/
│   └── miniApp.ts                 # API клиент
└── utils/
    └── telegram.ts                # Telegram SDK утилиты
```

---

## API Endpoints

### Турниры
- `GET /api/mini-app/tournaments/` — список турниров
- `GET /api/mini-app/tournaments/{id}/` — детали турнира
- `GET /api/mini-app/tournaments/my_tournaments/` — мои турниры
- `POST /api/mini-app/tournaments/{id}/register/` — регистрация

### Профиль
- `GET /api/mini-app/profile/` — профиль пользователя

**Аутентификация:** Через заголовок `X-Telegram-Init-Data`

---

## Troubleshooting

### Ошибка: "Invalid Telegram Web App data"

**Причина:** Неверный `TELEGRAM_BOT_TOKEN` или initData устарел.

**Решение:**
1. Проверь `TELEGRAM_BOT_TOKEN` в `.env`
2. Перезапусти backend: `docker-compose restart web`
3. Закрой и открой Mini App заново

### Ошибка: "Not running in Telegram Web App"

**Причина:** Открыл Mini App не через Telegram.

**Решение:** Открой через бота в Telegram.

### Кнопки не работают

**Причина:** Telegram SDK не инициализирован.

**Решение:** Проверь консоль браузера на ошибки. Убедись, что `@twa-dev/sdk` установлен.

### API возвращает 401

**Причина:** initData не передаётся или невалиден.

**Решение:**
1. Проверь, что Mini App открыто через Telegram
2. Проверь Network tab в DevTools — должен быть заголовок `X-Telegram-Init-Data`

---

## Полезные команды

```bash
# Установить зависимости
cd frontend && npm install

# Запустить dev сервер
npm run dev

# Собрать для production
npm run build

# Запустить ngrok
ngrok http 5173

# Перезапустить backend
docker-compose restart web

# Посмотреть логи
docker-compose logs -f web
```

---

## Следующие шаги

1. **Установить зависимости:** `cd frontend && npm install`
2. **Запустить ngrok:** `ngrok http 5173`
3. **Настроить в BotFather:** Menu Button URL
4. **Протестировать:** Открыть бота и нажать кнопку Web App

**Готово!** 🎉
