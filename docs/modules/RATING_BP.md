# Рейтинг BP (Beach Play)

## Описание
Внутренняя рейтинговая система BeachPlay для ранжирования игроков.

## Файлы
- Backend: `apps/players/services/rating.py`, `apps/players/api_views.py`
- Frontend: `frontend/src/pages/RatingPage.tsx`, `pages/PlayerCardPage.tsx`
- Models: `Player` (current_rating, peak_rating), `PlayerRatingHistory`

## API

### GET /api/players/?ordering=-current_rating
Список игроков с сортировкой по рейтингу

### GET /api/players/{id}/rating_history/
История изменения рейтинга игрока

## Логика

**Расчет рейтинга:**
```python
def calculate_bp_rating(player, tournament_result):
    # Факторы:
    # - Место в турнире
    # - Уровень турнира
    # - Рейтинг соперников
    # - Текущий рейтинг игрока
    
    new_rating = current_rating + delta
    return new_rating
```

**Обновление:**
- После завершения турнира
- Пересчет для всех участников
- Сохранение в PlayerRatingHistory

## UI/UX
- Таблица рейтинга с фильтрами (пол, город)
- График изменения рейтинга
- Пиковый рейтинг
- Позиция в общем рейтинге

## Метрики
- `current_rating` - текущий рейтинг
- `peak_rating` - максимальный рейтинг
- `rating_change` - изменение за период
- `rank` - позиция в рейтинге
