# Аутентификация и авторизация

## Описание
JWT-based аутентификация с регистрацией, входом, сбросом пароля и управлением токенами.

## Файлы
- Backend: `apps/accounts/models.py`, `apps/accounts/api_views.py`, `sandmatch/settings/base.py`
- Frontend: `frontend/src/pages/LoginPage.tsx`, `pages/RegisterPage.tsx`, `contexts/AuthContext.tsx`
- Models: `CustomUser`

## API

### POST /api/auth/register/
Регистрация
```json
{
  "email": "user@example.com",
  "password": "SecurePass123",
  "first_name": "Иван",
  "last_name": "Иванов"
}
```

### POST /api/auth/login/
Вход
```json
{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```
Response:
```json
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "role": "player"
  }
}
```

### POST /api/auth/refresh/
Обновить access токен
```json
{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### POST /api/auth/logout/
Выход (blacklist refresh token)

### POST /api/auth/password-reset/
Запрос сброса пароля
```json
{
  "email": "user@example.com"
}
```

### POST /api/auth/password-reset-confirm/
Подтверждение сброса
```json
{
  "token": "abc123",
  "password": "NewPass123"
}
```

## Модель CustomUser
```python
class CustomUser(AbstractUser):
    email = EmailField(unique=True)
    role = CharField(choices=[
        ('player', 'Игрок'),
        ('organizer', 'Организатор'),
        ('admin', 'Администратор')
    ], default='player')
    
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']
```

## JWT Settings
```python
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
}
```

## Frontend AuthContext
```typescript
interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (data: RegisterData) => Promise<void>;
  isAuthenticated: boolean;
}
```

## Защита маршрутов
```typescript
// Frontend
<PrivateRoute>
  <ProfilePage />
</PrivateRoute>

// Backend
@permission_classes([IsAuthenticated])
def my_view(request):
    ...
```

## Настройки
```env
JWT_SECRET_KEY=your-secret-key
ACCESS_TOKEN_LIFETIME=3600  # 1 hour
REFRESH_TOKEN_LIFETIME=604800  # 7 days
```
