# Аутентификация, Профиль и Роли - Детальная документация

## Описание

Комплексный модуль управления пользователями, включающий аутентификацию через JWT, управление профилем и систему ролей с разграничением прав доступа.

---

## Аутентификация (Auth)

### Модель User

```python
from django.contrib.auth.models.AbstractUser import AbstractUser

class User(AbstractUser):
    class Role(models.TextChoices):
        USER = 'USER', 'Пользователь'
        REFEREE = 'REFEREE', 'Судья'
        ORGANIZER = 'ORGANIZER', 'Организатор'
        ADMIN = 'ADMIN', 'Администратор'
    
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.USER)
    phone = models.CharField(max_length=20, blank=True)
    telegram_id = models.BigIntegerField(null=True, unique=True)
```

### JWT Authentication

**Используемая библиотека:** `djangorestframework-simplejwt`

**Настройки:**
```python
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}
```

### API Endpoints

**POST /api/auth/register/**

Регистрация нового пользователя.

```json
Request:
{
  "username": "ivanov",
  "email": "ivanov@example.com",
  "password": "SecurePass123",
  "first_name": "Иван",
  "last_name": "Иванов",
  "phone": "+79001234567"
}

Response:
{
  "user": {
    "id": 1,
    "username": "ivanov",
    "email": "ivanov@example.com",
    "role": "USER"
  },
  "tokens": {
    "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
    "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
  }
}
```

**POST /api/auth/login/**

Вход в систему.

```json
Request:
{
  "username": "ivanov",
  "password": "SecurePass123"
}

Response:
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "user": {
    "id": 1,
    "username": "ivanov",
    "role": "USER"
  }
}
```

**POST /api/auth/refresh/**

Обновление access token.

```json
Request:
{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}

Response:
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

**POST /api/auth/logout/**

Выход из системы (добавление refresh token в blacklist).

---

## Сброс пароля

### Процесс

1. **Запрос сброса** - пользователь вводит email
2. **Отправка токена** - на email отправляется ссылка с токеном
3. **Установка нового пароля** - пользователь переходит по ссылке и вводит новый пароль

### API

**POST /api/auth/password-reset/**

```json
Request:
{
  "email": "ivanov@example.com"
}

Response:
{
  "message": "Инструкции отправлены на email"
}
```

**POST /api/auth/password-reset-confirm/**

```json
Request:
{
  "token": "abc123def456",
  "password": "NewSecurePass123"
}

Response:
{
  "message": "Пароль успешно изменен"
}
```

---

## Профиль (Profile)

### Модель Player (связь с User)

```python
class Player(models.Model):
    user = models.OneToOneField(User, null=True, related_name='player')
    # ... остальные поля
```

### API Endpoints

**GET /api/profile/**

Получить профиль текущего пользователя.

```json
Response:
{
  "user": {
    "id": 1,
    "username": "ivanov",
    "email": "ivanov@example.com",
    "first_name": "Иван",
    "last_name": "Иванов",
    "role": "USER"
  },
  "player": {
    "id": 10,
    "display_name": "Иванов И.",
    "gender": "male",
    "birth_date": "1990-05-15",
    "city": "Москва",
    "phone": "+79001234567",
    "current_rating": 3500,
    "bp_rating": 3.5,
    "btr_rating": 1250
  },
  "stats": {
    "tournaments_played": 25,
    "tournaments_won": 3,
    "matches_played": 150,
    "win_rate": 0.65
  }
}
```

**PUT /api/profile/**

Обновить профиль.

```json
Request:
{
  "first_name": "Иван",
  "last_name": "Иванов",
  "phone": "+79001234567",
  "city": "Москва",
  "birth_date": "1990-05-15"
}

Response:
{
  "message": "Профиль обновлен"
}
```

**POST /api/profile/change-password/**

Изменить пароль.

```json
Request:
{
  "old_password": "OldPass123",
  "new_password": "NewPass456"
}

Response:
{
  "message": "Пароль изменен"
}
```

---

## Роли и права доступа (Roles)

### Иерархия ролей

```
ADMIN (все права)
  ↓
ORGANIZER (управление турнирами)
  ↓
REFEREE (ввод счета)
  ↓
USER (просмотр, регистрация)
```

### Описание ролей

**USER (Пользователь):**
- Просмотр турниров и рейтингов
- Регистрация на турниры через Mini-App
- Просмотр своей статистики
- Редактирование своего профиля

**REFEREE (Судья):**
- Все права USER
- Ввод счета матчей
- Начало/завершение матчей
- Фиксация специальных исходов

**ORGANIZER (Организатор):**
- Все права REFEREE
- Создание турниров
- Управление участниками
- Редактирование настроек турнира
- Удаление своих турниров (если не завершены)

**ADMIN (Администратор):**
- Все права ORGANIZER
- Управление пользователями
- Назначение ролей
- Удаление любых турниров
- Доступ к Django Admin

### Permission Classes

**IsAuthenticated:**
```python
from rest_framework.permissions import IsAuthenticated

class MyView(APIView):
    permission_classes = [IsAuthenticated]
```

**IsAuthenticatedAndRoleIn:**
```python
class IsAuthenticatedAndRoleIn(BasePermission):
    def __init__(self, *roles):
        self.allowed_roles = roles
    
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and
            request.user.role in self.allowed_roles
        )

# Использование
permission_classes = [IsAuthenticatedAndRoleIn('ADMIN', 'ORGANIZER')]
```

**IsTournamentCreatorOrAdmin:**
```python
class IsTournamentCreatorOrAdmin(BasePermission):
    def has_object_permission(self, request, view, obj):
        # ADMIN может всё
        if request.user.role == 'ADMIN':
            return True
        
        # Создатель турнира
        if hasattr(obj, 'created_by'):
            return obj.created_by == request.user
        
        return False
```

### Примеры использования

**Создание турнира:**
```python
@action(detail=False, methods=['post'])
@permission_classes([IsAuthenticatedAndRoleIn('ADMIN', 'ORGANIZER')])
def create_tournament(self, request):
    # Только ADMIN и ORGANIZER
    pass
```

**Удаление турнира:**
```python
@action(detail=True, methods=['delete'])
@permission_classes([IsTournamentCreatorOrAdmin])
def delete_tournament(self, request, pk=None):
    tournament = self.get_object()
    
    # ORGANIZER может удалить только незавершенные
    if request.user.role == 'ORGANIZER':
        if tournament.status == 'completed':
            raise PermissionDenied("Нельзя удалить завершенный турнир")
    
    tournament.delete()
```

**Ввод счета:**
```python
@action(detail=True, methods=['post'])
@permission_classes([IsAuthenticatedAndRoleIn('ADMIN', 'ORGANIZER', 'REFEREE')])
def save_score(self, request, pk=None):
    # ADMIN, ORGANIZER, REFEREE
    pass
```

---

## Frontend

### AuthContext

```tsx
interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  hasRole: (role: string) => boolean;
}

export const AuthContext = createContext<AuthContextType>(null);

export const AuthProvider: React.FC = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  
  const login = async (username: string, password: string) => {
    const response = await api.post('/auth/login/', { username, password });
    const { access, refresh, user } = response.data;
    
    // Сохранить токены
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
    
    setUser(user);
  };
  
  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  };
  
  const hasRole = (role: string) => {
    if (!user) return false;
    
    const hierarchy = {
      'ADMIN': ['ADMIN', 'ORGANIZER', 'REFEREE', 'USER'],
      'ORGANIZER': ['ORGANIZER', 'REFEREE', 'USER'],
      'REFEREE': ['REFEREE', 'USER'],
      'USER': ['USER']
    };
    
    return hierarchy[user.role]?.includes(role) || false;
  };
  
  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
};
```

### Protected Route

```tsx
const ProtectedRoute: React.FC<{ requiredRole?: string }> = ({ 
  requiredRole, 
  children 
}) => {
  const { isAuthenticated, hasRole } = useAuth();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  if (requiredRole && !hasRole(requiredRole)) {
    return <Navigate to="/forbidden" />;
  }
  
  return <>{children}</>;
};

// Использование
<Route path="/tournaments/create" element={
  <ProtectedRoute requiredRole="ORGANIZER">
    <CreateTournamentPage />
  </ProtectedRoute>
} />
```

### Условное отображение

```tsx
const TournamentActions: React.FC<{ tournament: Tournament }> = ({ tournament }) => {
  const { user, hasRole } = useAuth();
  
  const canEdit = hasRole('ADMIN') || 
    (hasRole('ORGANIZER') && tournament.created_by === user.id);
  
  const canDelete = hasRole('ADMIN') || 
    (hasRole('ORGANIZER') && tournament.created_by === user.id && tournament.status !== 'completed');
  
  return (
    <div className="actions">
      {canEdit && <Button onClick={handleEdit}>Редактировать</Button>}
      {canDelete && <Button onClick={handleDelete}>Удалить</Button>}
    </div>
  );
};
```

---

## Безопасность

### Хеширование паролей

Django использует PBKDF2 с SHA256 по умолчанию.

```python
from django.contrib.auth.hashers import make_password, check_password

# Хеширование
hashed = make_password('MyPassword123')

# Проверка
is_valid = check_password('MyPassword123', hashed)
```

### Валидация паролей

```python
PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 8}
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]
```

### CORS настройки

```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",  # React dev server
    "https://sandmatch.ru",   # Production
]

CORS_ALLOW_CREDENTIALS = True
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
