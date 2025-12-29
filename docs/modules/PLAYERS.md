# Управление игроками

## Описание
CRUD операции для игроков: создание, редактирование, удаление, поиск.

## Файлы
- Backend: `apps/players/models.py`, `apps/players/api_views.py`, `apps/players/admin.py`
- Frontend: `frontend/src/pages/PlayersPage.tsx`, `components/AddPlayerModal.tsx`
- Models: `Player`

## API

### GET /api/players/
Список игроков с фильтрами и поиском
```
?search=Иванов
&gender=male
&city=Москва
&ordering=-current_rating
```

### POST /api/players/
Создать игрока
```json
{
  "first_name": "Иван",
  "last_name": "Иванов",
  "gender": "male",
  "birth_date": "1990-01-15",
  "city": "Москва",
  "phone": "+79001234567"
}
```

### GET /api/players/{id}/
Детали игрока

### PUT /api/players/{id}/
Обновить игрока

### DELETE /api/players/{id}/
Удалить игрока (если нет связанных матчей)

## Модель Player
```python
class Player(models.Model):
    first_name = CharField(max_length=100)
    last_name = CharField(max_length=100)
    gender = CharField(choices=[('male', 'М'), ('female', 'Ж')])
    birth_date = DateField(null=True)
    city = CharField(max_length=100, blank=True)
    phone = CharField(max_length=20, blank=True)
    current_rating = IntegerField(default=0)
    peak_rating = IntegerField(default=0)
    display_name = CharField()  # auto: "Фамилия И."
```

## UI/UX
- Таблица игроков с поиском
- Фильтры: пол, город, рейтинг
- Модальное окно добавления/редактирования
- Карточка игрока при клике
- Экспорт в Excel

## Валидация
- Обязательные: first_name, last_name, gender
- Уникальность: first_name + last_name + birth_date
- Телефон: валидация формата
