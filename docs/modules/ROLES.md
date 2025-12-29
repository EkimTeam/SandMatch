# Роли и права доступа

## Описание
Система ролей (Player, Organizer, Admin) с разграничением прав доступа к функциям.

## Файлы
- Backend: `apps/accounts/models.py` (CustomUser.role), `apps/accounts/permissions.py`
- Frontend: `frontend/src/pages/UserRolesPage.tsx`, `contexts/AuthContext.tsx`

## Роли

### PLAYER (Игрок)
**Права:**
- Просмотр турниров
- Регистрация на турниры
- Просмотр своей статистики
- Редактирование своего профиля

**Ограничения:**
- Не может создавать турниры
- Не может редактировать чужие данные

### ORGANIZER (Организатор)
**Права:**
- Все права PLAYER
- Создание турниров
- Редактирование своих турниров
- Управление участниками турнира
- Ввод счета матчей

**Ограничения:**
- Не может редактировать чужие турниры
- Не может управлять пользователями

### ADMIN (Администратор)
**Права:**
- Все права ORGANIZER
- Редактирование всех турниров
- Управление пользователями
- Изменение ролей
- Доступ к Django Admin

## API

### GET /api/users/roles/
Список пользователей с ролями (только ADMIN)

### PUT /api/users/{id}/role/
Изменить роль пользователя (только ADMIN)
```json
{
  "role": "organizer"
}
```

## Permissions (Backend)

```python
# apps/accounts/permissions.py

class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.role == 'admin'

class IsOrganizer(BasePermission):
    def has_permission(self, request, view):
        return request.user.role in ['organizer', 'admin']

class IsTournamentCreator(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.created_by == request.user or request.user.role == 'admin'
```

## Использование

```python
# В API views
@permission_classes([IsAuthenticated, IsOrganizer])
def create_tournament(request):
    ...

@permission_classes([IsAuthenticated, IsTournamentCreator])
def edit_tournament(request, pk):
    ...
```

## Frontend проверки

```typescript
// AuthContext
const canCreateTournament = user?.role === 'organizer' || user?.role === 'admin';
const canEditTournament = tournament.created_by === user?.id || user?.role === 'admin';

// Условный рендеринг
{canCreateTournament && (
  <Button onClick={createTournament}>Создать турнир</Button>
)}
```

## UI/UX
- Скрытие кнопок для недоступных действий
- Отображение роли в профиле
- Страница управления ролями (только ADMIN)
- Запрос повышения роли до ORGANIZER
