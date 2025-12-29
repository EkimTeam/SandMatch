# Рейтинг BTR (Beach Tennis Rating)

## Описание
Интеграция с внешней рейтинговой системой BTR. Синхронизация данных и маппинг в BP рейтинг.

## Файлы
- Backend: `apps/btr/services/rating.py`, `apps/btr/api_views.py`, `apps/btr/models.py`
- Frontend: `frontend/src/pages/BTRPlayerCardPage.tsx`
- Models: `BTRPlayer`, `BTRTournament`, `BTRMatch`
- Docs: `docs/BTR_TO_BP_RATING_MAPPING.md`

## API

### GET /api/btr/players/
Список BTR игроков

### GET /api/btr/players/{id}/
Карточка BTR игрока

### POST /api/btr/sync/
Синхронизация BTR → BP

## Логика

**Синхронизация:**
```python
def sync_btr_to_bp():
    # 1. Получить данные из BTR API
    # 2. Создать/обновить BTRPlayer
    # 3. Маппинг BTR rating → BP rating
    # 4. Обновить Player.current_rating
```

**Маппинг BTR → BP:**
```python
BTR_TO_BP_MAPPING = {
    1000: 100,   # BTR 1000 = BP 100
    1500: 500,   # BTR 1500 = BP 500
    2000: 1000,  # BTR 2000 = BP 1000
    # Линейная интерполяция между точками
}
```

## UI/UX
- Карточка BTR игрока с историей
- Кнопка "Синхронизировать с BTR"
- Отображение BTR и BP рейтинга
- Последняя дата синхронизации

## Настройки
```env
BTR_API_URL=https://api.btr.com
BTR_API_KEY=your_api_key
```

## Troubleshooting
- Ошибка синхронизации → проверить BTR_API_KEY
- Неверный маппинг → обновить BTR_TO_BP_MAPPING.md
