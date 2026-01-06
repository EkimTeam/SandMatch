# Управление игроками - Детальная документация

## Описание

Модуль управления игроками - центральный компонент системы, отвечающий за хранение данных игроков, их рейтингов, статистики и связей с турнирами.

---

## Модель Player

```python
class Player(models.Model):
    # Основные данные
    last_name = models.CharField(max_length=100)
    first_name = models.CharField(max_length=100)
    middle_name = models.CharField(max_length=100, blank=True)
    display_name = models.CharField(max_length=200, blank=True)
    
    # Контакты
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    telegram_username = models.CharField(max_length=100, blank=True)
    
    # Характеристики
    gender = models.CharField(choices=[('male', 'М'), ('female', 'Ж')])
    birth_date = models.DateField(null=True, blank=True)
    city = models.CharField(max_length=100, blank=True)
    
    # Рейтинги
    current_rating = models.IntegerField(default=1000)  # BP * 1000
    btr_rating = models.IntegerField(null=True)
    
    # Связи
    user = models.OneToOneField(User, null=True, related_name='player')
    btr_player = models.OneToOneField(BtrPlayer, null=True)
    
    # Метаданные
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

---

## API Endpoints

### GET /api/players/
Список всех игроков с фильтрацией и поиском.

**Query params:**
- `search` - поиск по ФИО
- `gender` - фильтр по полу
- `city` - фильтр по городу
- `min_rating` / `max_rating` - диапазон рейтинга

**Response:**
```json
{
  "count": 150,
  "results": [
    {
      "id": 1,
      "last_name": "Иванов",
      "first_name": "Иван",
      "display_name": "Иванов И.",
      "gender": "male",
      "city": "Москва",
      "current_rating": 3500,
      "bp_rating": 3.5,
      "btr_rating": 1250
    }
  ]
}
```

### POST /api/players/
Создать нового игрока (ADMIN/ORGANIZER).

**Request:**
```json
{
  "last_name": "Петров",
  "first_name": "Петр",
  "gender": "male",
  "phone": "+79001234567",
  "city": "Санкт-Петербург",
  "current_rating": 2500
}
```

### GET /api/players/{id}/
Детальная информация об игроке.

**Response:**
```json
{
  "id": 1,
  "last_name": "Иванов",
  "first_name": "Иван",
  "display_name": "Иванов И.",
  "gender": "male",
  "birth_date": "1990-05-15",
  "city": "Москва",
  "phone": "+79001234567",
  "email": "ivanov@example.com",
  "current_rating": 3500,
  "bp_rating": 3.5,
  "btr_rating": 1250,
  "tournaments_played": 25,
  "tournaments_won": 3,
  "win_rate": 0.65
}
```

### PUT /api/players/{id}/
Обновить данные игрока (ADMIN/ORGANIZER или сам игрок).

### DELETE /api/players/{id}/
Удалить игрока (только ADMIN).

---

## Frontend компоненты

### PlayersPage.tsx
Страница со списком всех игроков.

**Функционал:**
- Поиск в реальном времени
- Фильтры (пол, город, рейтинг)
- Сортировка по рейтингу/имени
- Пагинация
- Кнопка "Добавить игрока" (для ADMIN/ORGANIZER)

### PlayerCardPage.tsx
Карточка игрока с детальной информацией.

**Разделы:**
- Основная информация
- Рейтинги (BP, BTR)
- Статистика турниров
- История матчей
- График рейтинга

---

## Статистика игрока

### Расчет статистики

```python
def calculate_player_stats(player: Player) -> Dict:
    """Рассчитать статистику игрока"""
    # Турниры
    tournaments = Tournament.objects.filter(
        entries__team__player_1=player
    ).distinct()
    
    # Матчи
    matches = Match.objects.filter(
        Q(team_1__player_1=player) | Q(team_2__player_1=player),
        status='completed'
    )
    
    wins = matches.filter(winner__player_1=player).count()
    total = matches.count()
    
    return {
        'tournaments_played': tournaments.count(),
        'tournaments_won': tournaments.filter(
            entries__final_place=1,
            entries__team__player_1=player
        ).count(),
        'matches_played': total,
        'matches_won': wins,
        'win_rate': wins / total if total > 0 else 0,
    }
```

---

## Поиск игроков

### Алгоритм поиска

```python
def search_players(query: str) -> QuerySet:
    """
    Поиск игроков по ФИО.
    
    Поддерживает:
    - Полное имя: "Иванов Иван"
    - Частичное совпадение: "Иван"
    - Несколько слов: "Иван Петр"
    """
    if not query:
        return Player.objects.all()
    
    # Разбить запрос на слова
    words = query.strip().split()
    
    # Построить Q объекты для каждого слова
    q_objects = Q()
    for word in words:
        q_objects |= (
            Q(last_name__icontains=word) |
            Q(first_name__icontains=word) |
            Q(display_name__icontains=word)
        )
    
    return Player.objects.filter(q_objects).distinct()
```

---

## Импорт/Экспорт

**Примечание:** Функции импорта/экспорта игроков из Excel в текущей версии не реализованы. 

**Планируется в будущих версиях:**
- Импорт игроков из Excel/CSV файлов
- Экспорт списка игроков в Excel/CSV
- Массовое обновление данных игроков

**Текущий способ добавления игроков:**
- Через Django Admin (`/sm-admin/players/player/`)
- Через API endpoint `POST /api/players/`
- Через UI форму "Добавить игрока" (для ADMIN/ORGANIZER)

---

**Версия:** 1.0  
**Дата:** 5 января 2026
