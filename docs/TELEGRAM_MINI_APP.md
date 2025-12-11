# Telegram Mini App для SandMatch

## Что такое Telegram Mini App?

Telegram Mini App — это веб-приложение, которое открывается **внутри Telegram** и имеет доступ к:
- Данным пользователя Telegram (ID, имя, username)
- Нативным функциям (тема оформления, haptic feedback, кнопки)
- Платёжной системе Telegram (опционально)

## Архитектура

```
┌─────────────────────────────────────┐
│      Telegram Client                │
│  ┌───────────────────────────────┐  │
│  │   Mini App (React)            │  │
│  │   /mini-app/                  │  │
│  │   - Турниры                   │  │
│  │   - Регистрация               │  │
│  │   - Профиль                   │  │
│  └───────────────────────────────┘  │
│              ▼ API                  │
└──────────────┼──────────────────────┘
               ▼
┌──────────────────────────────────────┐
│   Django Backend                     │
│   /api/mini-app/                     │
│   - Аутентификация через Telegram    │
│   - CRUD турниров                    │
│   - Регистрация на турниры           │
└──────────────────────────────────────┘
```

---

## Backend API (готово ✅)

### Аутентификация

Mini App использует **Telegram Web App initData** для аутентификации.

**Как это работает:**
1. Telegram передаёт `initData` при открытии Mini App
2. Backend проверяет HMAC подпись с использованием `TELEGRAM_BOT_TOKEN`
3. Если подпись валидна — пользователь аутентифицирован

**Класс аутентификации:** `TelegramWebAppAuthentication`

### API Endpoints

#### 1. Список турниров
```http
GET /api/mini-app/tournaments/
X-Telegram-Init-Data: <initData>
```

**Query параметры:**
- `status` — фильтр по статусу (`created`, `active`, `completed`)

**Ответ:**
```json
[
  {
    "id": 1,
    "name": "Турнир выходного дня",
    "date": "2024-12-15T10:00:00Z",
    "status": "created",
    "venue_name": "Пляж Центральный",
    "participants_count": 8,
    "max_teams": 16,
    "is_registered": false
  }
]
```

#### 2. Детали турнира
```http
GET /api/mini-app/tournaments/{id}/
X-Telegram-Init-Data: <initData>
```

**Ответ:**
```json
{
  "id": 1,
  "name": "Турнир выходного дня",
  "date": "2024-12-15T10:00:00Z",
  "status": "created",
  "venue_name": "Пляж Центральный",
  "venue_address": "ул. Пляжная, 1",
  "participants_count": 8,
  "max_teams": 16,
  "is_registered": false,
  "organizer_name": "Иван Иванов",
  "description": "Описание турнира",
  "entry_fee": 1000,
  "prize_fund": 10000,
  "system": "round_robin"
}
```

#### 3. Мои турниры
```http
GET /api/mini-app/tournaments/my_tournaments/
X-Telegram-Init-Data: <initData>
```

Возвращает турниры пользователя в порядке:
1. Active турниры
2. Created турниры (предстоящие)
3. Completed турниры (минимум 1, максимум до 5 общих)

#### 4. Регистрация на турнир
```http
POST /api/mini-app/tournaments/{id}/register/
X-Telegram-Init-Data: <initData>
Content-Type: application/json

{
  "partner_id": 123  // опционально
}
```

**Ответ:**
```json
{
  "message": "Успешно зарегистрированы на турнир",
  "tournament": { /* детали турнира */ }
}
```

#### 5. Профиль пользователя
```http
GET /api/mini-app/profile/
X-Telegram-Init-Data: <initData>
```

**Ответ:**
```json
{
  "telegram_id": 123456789,
  "username": "john_doe",
  "first_name": "John",
  "last_name": "Doe",
  "player": {
    "id": 1,
    "full_name": "John Doe",
    "rating": 1500,
    "tournaments_played": 10,
    "tournaments_won": 2
  },
  "is_linked": true
}
```

---

## Интеграция с ботом (готово ✅)

### Web App кнопки в боте

В команде `/start` добавлены кнопки:
- **🎾 Открыть BeachPlay** → `/mini-app/`
- **🏆 Турниры** → `/mini-app/tournaments`
- **👤 Мой профиль** → `/mini-app/profile`

**Код:**
```python
keyboard = InlineKeyboardMarkup(inline_keyboard=[
    [
        InlineKeyboardButton(
            text="🎾 Открыть BeachPlay",
            web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/")
        )
    ]
])
```

---

## Frontend (нужно реализовать)

### Технологии

- **React 18** — уже используется в проекте
- **Telegram Web App SDK** — для интеграции с Telegram
- **React Router** — для навигации
- **Axios** — для API запросов
- **TailwindCSS** — для стилей

### Структура страниц

```
/mini-app/
├── index.tsx              # Главная страница
├── tournaments/
│   ├── index.tsx          # Список турниров
│   └── [id].tsx           # Детали турнира
└── profile/
    └── index.tsx          # Профиль пользователя
```

### Установка Telegram Web App SDK

```bash
npm install @twa-dev/sdk
```

### Пример использования SDK

```typescript
import WebApp from '@twa-dev/sdk'

// Инициализация
WebApp.ready()

// Получение initData для API
const initData = WebApp.initData

// Отправка запроса к API
const response = await fetch('/api/mini-app/tournaments/', {
  headers: {
    'X-Telegram-Init-Data': initData
  }
})

// Использование темы Telegram
const theme = WebApp.themeParams

// Haptic feedback
WebApp.HapticFeedback.impactOccurred('medium')

// Кнопка "Назад"
WebApp.BackButton.show()
WebApp.BackButton.onClick(() => {
  // Обработка нажатия
})

// Главная кнопка
WebApp.MainButton.setText('Зарегистрироваться')
WebApp.MainButton.show()
WebApp.MainButton.onClick(() => {
  // Регистрация на турнир
})
```

---

## Настройка Mini App в BotFather

### 1. Открой BotFather

Найди [@BotFather](https://t.me/BotFather) в Telegram

### 2. Настрой Web App

```
/mybots
→ Выбери своего бота
→ Bot Settings
→ Menu Button
→ Configure menu button
→ Send URL: https://beachplay.ru/mini-app/
→ Send Button text: Открыть BeachPlay
```

### 3. Настрой домен (для production)

```
/mybots
→ Выбери своего бота
→ Bot Settings
→ Web App Domain
→ Send domain: beachplay.ru
```

Telegram попросит подтвердить домен через файл на сервере.

---

## Разработка Frontend

### Шаг 1: Создать страницы Mini App

```bash
cd frontend/src/pages
mkdir MiniApp
cd MiniApp
```

Создать:
- `MiniAppLayout.tsx` — общий layout с Telegram SDK
- `MiniAppHome.tsx` — главная страница
- `MiniAppTournaments.tsx` — список турниров
- `MiniAppTournamentDetail.tsx` — детали турнира
- `MiniAppProfile.tsx` — профиль

### Шаг 2: Настроить роутинг

```typescript
// App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MiniAppLayout from './pages/MiniApp/MiniAppLayout'
import MiniAppHome from './pages/MiniApp/MiniAppHome'
// ...

<Routes>
  <Route path="/mini-app" element={<MiniAppLayout />}>
    <Route index element={<MiniAppHome />} />
    <Route path="tournaments" element={<MiniAppTournaments />} />
    <Route path="tournaments/:id" element={<MiniAppTournamentDetail />} />
    <Route path="profile" element={<MiniAppProfile />} />
  </Route>
</Routes>
```

### Шаг 3: Создать API клиент

```typescript
// api/miniApp.ts
import WebApp from '@twa-dev/sdk'
import axios from 'axios'

const api = axios.create({
  baseURL: '/api/mini-app',
  headers: {
    'X-Telegram-Init-Data': WebApp.initData
  }
})

export const getTournaments = (status?: string) => 
  api.get('/tournaments/', { params: { status } })

export const getTournamentDetail = (id: number) => 
  api.get(`/tournaments/${id}/`)

export const registerForTournament = (id: number, partnerId?: number) =>
  api.post(`/tournaments/${id}/register/`, { partner_id: partnerId })

export const getProfile = () => 
  api.get('/profile/')

export const getMyTournaments = () => 
  api.get('/tournaments/my_tournaments/')
```

---

## Тестирование

### Локальное тестирование

1. **Запусти ngrok** (для доступа к localhost из Telegram):
```bash
ngrok http 8080
```

2. **Обнови WEB_APP_URL** в `.env`:
```env
WEB_APP_URL=https://your-ngrok-url.ngrok.io
```

3. **Настрой в BotFather**:
```
Menu Button URL: https://your-ngrok-url.ngrok.io/mini-app/
```

4. **Открой бота** и нажми кнопку Web App

### Production тестирование

1. **Задеплой фронтенд** на `beachplay.ru`

2. **Обнови WEB_APP_URL**:
```env
WEB_APP_URL=https://beachplay.ru
```

3. **Настрой в BotFather**:
```
Menu Button URL: https://beachplay.ru/mini-app/
```

---

## Чеклист реализации

### Backend (✅ Готово)
- [x] Аутентификация через Telegram Web App
- [x] API для списка турниров
- [x] API для деталей турнира
- [x] API для регистрации на турнир
- [x] API для профиля пользователя
- [x] API для моих турниров
- [x] Web App кнопки в боте

### Frontend (❌ Нужно реализовать)
- [ ] Установить @twa-dev/sdk
- [ ] Создать MiniAppLayout с инициализацией SDK
- [ ] Страница списка турниров
- [ ] Страница деталей турнира
- [ ] Страница профиля
- [ ] API клиент с Telegram initData
- [ ] Адаптивный дизайн под мобильные
- [ ] Поддержка темы Telegram
- [ ] Haptic feedback для кнопок

### Настройка (❌ Нужно сделать)
- [ ] Настроить Menu Button в BotFather
- [ ] Подтвердить домен в BotFather (для production)
- [ ] Протестировать локально через ngrok
- [ ] Задеплоить на production

---

## Полезные ссылки

- [Telegram Web Apps Documentation](https://core.telegram.org/bots/webapps)
- [@twa-dev/sdk GitHub](https://github.com/twa-dev/sdk)
- [BotFather](https://t.me/BotFather)
- [Telegram Web App Examples](https://github.com/telegram-mini-apps)

---

## Следующие шаги

1. **Реализовать Frontend** — создать React компоненты для Mini App
2. **Настроить в BotFather** — добавить Menu Button
3. **Протестировать** — локально через ngrok
4. **Задеплоить** — на production

**Хочешь, чтобы я начал реализацию Frontend?**
