# Mini-App (Telegram)

## Описание
Telegram WebApp для регистрации на турниры, просмотра расписания и результатов.

## Файлы
- Backend: `apps/telegram_bot/api_views.py` (MiniAppViewSet), `apps/telegram_bot/api_serializers.py`
- Frontend: `frontend/src/pages/MiniApp/` (все страницы), `frontend/src/api/miniApp.ts`

## Страницы

### MiniAppHome.tsx
Главная страница с навигацией
- Ближайшие турниры
- Мои турниры
- Профиль

### MiniAppTournaments.tsx
Список всех турниров
- Фильтры: дата, город, статус
- Карточки турниров
- Кнопка "Зарегистрироваться"

### MiniAppTournamentDetail.tsx
Детали турнира
- Информация о турнире
- Список участников
- Кнопка регистрации/отмены
- Расписание (если турнир начался)

### MiniAppMyTournaments.tsx
Мои турниры
- Предстоящие
- Текущие
- Завершенные

### MiniAppProfile.tsx
Профиль пользователя
- Статистика
- Рейтинг
- История турниров

### MiniAppInvitations.tsx
Приглашения в пары
- Входящие приглашения
- Исходящие приглашения

## API

### GET /api/miniapp/tournaments/
Список турниров для Mini-App
```
?status=upcoming
&city=Москва
&date_from=2024-01-01
```

### GET /api/miniapp/tournaments/{id}/
Детали турнира

### GET /api/miniapp/profile/
Профиль текущего Telegram пользователя
```json
{
  "telegram_user": {
    "id": 1,
    "telegram_id": 123456789,
    "first_name": "Иван"
  },
  "player": {
    "id": 5,
    "current_rating": 850
  },
  "tournaments_count": 12,
  "upcoming_tournaments": [...]
}
```

### POST /api/miniapp/tournaments/{id}/register/
Регистрация (см. REGISTRATION.md)

## Инициализация

```typescript
// frontend/src/api/miniApp.ts
import { WebApp } from '@twa-dev/sdk';

// Получение данных пользователя
const initData = WebApp.initDataUnsafe;
const telegramUserId = initData.user?.id;

// Настройка темы
WebApp.setHeaderColor('#2196F3');
WebApp.setBackgroundColor('#FFFFFF');

// Кнопка "Назад"
WebApp.BackButton.onClick(() => {
  navigate(-1);
});
```

## Аутентификация

```python
# Backend: проверка initData
def verify_telegram_webapp_data(init_data: str) -> dict:
    # Проверка подписи Telegram
    # Возврат данных пользователя
    
# Middleware для Mini-App
class TelegramWebAppAuthMiddleware:
    def __call__(self, request):
        init_data = request.headers.get('X-Telegram-Init-Data')
        user_data = verify_telegram_webapp_data(init_data)
        request.telegram_user = user_data
```

## UI/UX
- Адаптивный дизайн под Telegram
- Использование Telegram цветов
- Кнопки Telegram (MainButton, BackButton)
- Haptic Feedback
- Плавные переходы

## Компоненты

### RegistrationModal
- Выбор напарника
- Поиск напарника
- Подтверждение регистрации

### PartnerSearchModal
- Список ищущих напарника
- Кнопка "Пригласить"

### TournamentParticipants
- Список участников
- Статусы регистрации
- Позиция в очереди

## Настройки
```env
TELEGRAM_BOT_USERNAME=beachplay_bot
MINIAPP_URL=https://beachplay.ru/miniapp/
```

## Troubleshooting
- initData не валидируется → проверить TELEGRAM_BOT_TOKEN
- Темная тема не работает → использовать WebApp.colorScheme
- Кнопки не отображаются → проверить WebApp.MainButton.show()
