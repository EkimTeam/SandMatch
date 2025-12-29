# Личный кабинет

## Описание
Профиль пользователя с редактированием данных, связью с игроком, историей турниров.

## Файлы
- Backend: `apps/accounts/api_views.py` (ProfileView, UpdateProfileView)
- Frontend: `frontend/src/pages/ProfilePage.tsx`, `components/ProfileEditForm.tsx`
- Models: `CustomUser`, связь с `Player`

## API

### GET /api/auth/profile/
Получить профиль текущего пользователя
```json
{
  "id": 1,
  "email": "user@example.com",
  "first_name": "Иван",
  "last_name": "Иванов",
  "role": "player",
  "player": {
    "id": 5,
    "current_rating": 850,
    "tournaments_played": 12
  },
  "avatar": "/media/avatars/user1.jpg"
}
```

### PUT /api/auth/profile/
Обновить профиль
```json
{
  "first_name": "Иван",
  "last_name": "Петров",
  "phone": "+79001234567",
  "city": "Москва"
}
```

### POST /api/auth/profile/avatar/
Загрузить аватар
```
Content-Type: multipart/form-data
avatar: <file>
```

## UI/UX
- Карточка профиля с аватаром
- Форма редактирования
- Связь с игроком (если есть)
- Статистика турниров
- История участия
- Настройки уведомлений

## Связь User ↔ Player
```python
# При регистрации автоматически создается Player
@receiver(post_save, sender=CustomUser)
def create_player(sender, instance, created, **kwargs):
    if created:
        Player.objects.create(
            first_name=instance.first_name,
            last_name=instance.last_name,
            user=instance
        )
```

## Редактируемые поля
- first_name, last_name
- phone, city
- avatar
- notification_settings
