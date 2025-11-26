# Стартовый BP рейтинг игроков

## Обзор

Система автоматического определения стартового BP рейтинга для игроков на основе их BTR рейтинга или характеристик турнира.

## Логика определения стартового рейтинга

### 1. Приоритет BTR

Если у игрока есть связь с BTR (`player.btr_player_id`), стартовый BP рейтинг рассчитывается по формуле маппинга BTR → BP.

**Формула:**

```python
if BTR < 80:
    BP = 1000  # Любители
elif BTR >= 1500:
    # Элита: штраф растет по мере удаления от 1500
    capped_btr = min(BTR, 4000)
    BP = 1600 + 400 * ((capped_btr - 1500) / 2500) ** 1.05
else:
    # Профессионалы: быстрый рост в начале
    BP = 1000 + 600 * ((BTR - 80) / 1420) ** 0.7
```

**Примеры:**
- BTR 50 → BP 1000 (любитель)
- BTR 100 → BP 1030 (начинающий профессионал)
- BTR 500 → BP 1256 (сильный профессионал)
- BTR 1500 → BP 1600 (элита, порог)
- BTR 2750 → BP 1793 (элита, очень высокий уровень)
- BTR 4000 → BP 2000 (максимум)

Подробнее см. [BTR_TO_BP_RATING_MAPPING.md](BTR_TO_BP_RATING_MAPPING.md)

### 2. По названию турнира

Если у игрока нет связи с BTR, стартовый рейтинг определяется по названию турнира:

| Условие | BP рейтинг | Описание |
|---------|------------|----------|
| "hard" или "ПроАм" в названии | 1050 | Турниры высокого уровня |
| "medium" в названии | 950 | Турниры среднего уровня |
| Остальные случаи | 1000 | Стандартный стартовый рейтинг |

### 3. Дефолтное значение

Если нет связи с BTR и не передан турнир → **BP = 1000**

## Применение в системе

### 1. Создание нового игрока

При создании игрока через API (`POST /players/create/`):

```python
# apps/players/views.py
from apps.players.services.initial_rating_service import get_initial_bp_rating

# Определяем стартовый рейтинг (проверяем BTR)
initial_rating = get_initial_bp_rating(Player(first_name=first_name, last_name=last_name))

player = Player.objects.create(
    first_name=first_name,
    last_name=last_name,
    current_rating=initial_rating
)
```

### 2. Расчет рейтинга в турнире

При расчете рейтинга для турнира (`compute_ratings_for_tournament`):

```python
# apps/players/services/rating_service.py
from apps.players.services.initial_rating_service import get_initial_bp_rating

# Если рейтинг = 0, определяем стартовый рейтинг
ratings_before: Dict[int, float] = {}
for pid, p in players_map.items():
    if p.current_rating and p.current_rating > 0:
        ratings_before[pid] = float(p.current_rating)
    else:
        # Определяем стартовый рейтинг по BTR или по названию турнира
        initial_rating = get_initial_bp_rating(p, tournament)
        ratings_before[pid] = float(initial_rating)
```

### 3. Связывание с BTR

При связывании игрока BP с игроком BTR (`scripts/link_bp_btr_players.py`):

```python
# Если у игрока нет рейтинга, устанавливаем стартовый из BTR
if not bp_player.current_rating or bp_player.current_rating == 0:
    initial_rating = get_initial_bp_rating(bp_player)
    bp_player.current_rating = initial_rating
    bp_player.save(update_fields=['btr_player_id', 'current_rating'])
```

## Скрипты

### 1. Связывание BP и BTR игроков

Автоматически связывает игроков BP с BTR по совпадению Фамилия+Имя и устанавливает стартовый рейтинг:

```bash
# Тестовый запуск (без изменений)
docker compose exec web python scripts/link_bp_btr_players.py --dry-run

# Реальный запуск
docker compose exec web python scripts/link_bp_btr_players.py

# С подробным выводом
docker compose exec web python scripts/link_bp_btr_players.py --verbose
```

**Что делает:**
- Ищет совпадения по Фамилия+Имя
- Устанавливает связь `player.btr_player_id`
- Если `current_rating = 0`, рассчитывает и устанавливает стартовый BP рейтинг из BTR
- Создает отчет в JSON

### 2. Установка стартового BP рейтинга

Устанавливает стартовый BP рейтинг всем игрокам с `current_rating = 0`:

```bash
# Тестовый запуск (без изменений)
docker compose exec web python scripts/set_initial_bp_ratings.py --dry-run

# Реальный запуск
docker compose exec web python scripts/set_initial_bp_ratings.py

# С подробным выводом
docker compose exec web python scripts/set_initial_bp_ratings.py --verbose

# Обновить рейтинг даже если он уже установлен
docker compose exec web python scripts/set_initial_bp_ratings.py --force
```

**Что делает:**
- Для игроков с BTR связью → рассчитывает BP рейтинг по формуле
- Для игроков без BTR → устанавливает 1000
- Группирует результаты по диапазонам рейтинга
- Создает отчет в JSON

## API

### Функция get_initial_bp_rating

```python
from apps.players.services.initial_rating_service import get_initial_bp_rating

def get_initial_bp_rating(player, tournament=None) -> int:
    """
    Определяет стартовый BP рейтинг для игрока.
    
    Args:
        player: Объект Player
        tournament: Объект Tournament (опционально)
    
    Returns:
        Стартовый BP рейтинг (целое число)
    """
```

**Примеры использования:**

```python
# При создании игрока
player = Player(first_name="Иван", last_name="Иванов")
initial_rating = get_initial_bp_rating(player)

# При расчете рейтинга в турнире
tournament = Tournament.objects.get(id=123)
initial_rating = get_initial_bp_rating(player, tournament)
```

### Функция calculate_initial_bp_rating_from_btr

```python
from apps.players.services.btr_rating_mapper import calculate_initial_bp_rating_from_btr

def calculate_initial_bp_rating_from_btr(btr_player_id: int) -> int:
    """
    Рассчитывает стартовый BP рейтинг на основе BTR рейтинга.
    
    Args:
        btr_player_id: ID игрока в системе BTR
    
    Returns:
        Стартовый BP рейтинг (от 1000 до 2000)
    """
```

### Функция calculate_bp_from_btr_value

```python
from apps.players.services.btr_rating_mapper import calculate_bp_from_btr_value

def calculate_bp_from_btr_value(btr_value: int) -> int:
    """
    Рассчитывает BP рейтинг напрямую из значения BTR (без обращения к БД).
    
    Args:
        btr_value: Значение BTR рейтинга
    
    Returns:
        BP рейтинг (от 1000 до 2000)
    """
```

## Примеры

### Пример 1: Профессионал с BTR

```python
# Игрок с BTR рейтингом 500
player = Player.objects.get(id=123)
player.btr_player_id = 456  # Связь с BTR

initial_rating = get_initial_bp_rating(player)
# Результат: 1256
```

### Пример 2: Любитель без BTR на турнире "hard"

```python
# Игрок без BTR на турнире высокого уровня
player = Player.objects.get(id=789)
player.btr_player_id = None

tournament = Tournament.objects.get(name="Summer Hard Championship")
initial_rating = get_initial_bp_rating(player, tournament)
# Результат: 1050 (из-за "hard" в названии)
```

### Пример 3: Новый игрок без BTR

```python
# Новый игрок без BTR и турнира
player = Player(first_name="Петр", last_name="Петров")
initial_rating = get_initial_bp_rating(player)
# Результат: 1000 (дефолт)
```

### Пример 4: Элита с BTR 2750

```python
# Топ-игрок с очень высоким BTR
player = Player.objects.get(id=999)
player.btr_player_id = 111  # BTR рейтинг 2750

initial_rating = get_initial_bp_rating(player)
# Результат: 1793
```

## Мониторинг

После внедрения рекомендуется:

1. **Отслеживать распределение стартовых рейтингов:**
   ```sql
   SELECT 
       CASE 
           WHEN current_rating < 1100 THEN '1000-1100'
           WHEN current_rating < 1200 THEN '1100-1200'
           WHEN current_rating < 1300 THEN '1200-1300'
           WHEN current_rating < 1400 THEN '1300-1400'
           WHEN current_rating < 1500 THEN '1400-1500'
           WHEN current_rating < 1600 THEN '1500-1600'
           WHEN current_rating < 1700 THEN '1600-1700'
           WHEN current_rating < 1800 THEN '1700-1800'
           WHEN current_rating < 1900 THEN '1800-1900'
           ELSE '1900-2000'
       END as rating_range,
       COUNT(*) as count
   FROM players_player
   WHERE btr_player_id IS NOT NULL
   GROUP BY rating_range
   ORDER BY rating_range;
   ```

2. **Проверять корректность маппинга:**
   - Сравнивать результаты игроков с BTR в первых турнирах
   - Анализировать отклонения от ожидаемого уровня

3. **Корректировать формулу при необходимости:**
   - Изменить степень для профессионалов (0.7)
   - Изменить степень для элиты (1.05)
   - Изменить пороги для турниров (1050/950/1000)

## Заключение

Система автоматического определения стартового BP рейтинга обеспечивает:

- ✅ **Точность:** Использует реальные BTR данные для профессионалов
- ✅ **Гибкость:** Учитывает уровень турнира для игроков без BTR
- ✅ **Справедливость:** Разные стартовые рейтинги для разных уровней
- ✅ **Простота:** Автоматическое применение при создании игрока и расчете рейтинга
- ✅ **Безопасность:** Ограничение максимального стартового рейтинга (2000)
