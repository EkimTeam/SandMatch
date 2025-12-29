# Рейтинг BP (Beach Play) - Детальная документация

## Описание

BP (Beach Play) - внутренняя рейтинговая система SandMatch, основанная на уровнях от 1.0 до 5.0. Используется для балансировки турниров и подбора соперников.

**Ключевые особенности:**
- Шкала от 1.0 до 5.0 с шагом 0.5
- Автоматический расчет на основе результатов матчей
- Конвертация из BTR рейтинга
- История изменений рейтинга
- Отображение в профиле игрока

---

## Шкала рейтинга

### Уровни BP

```
5.0 - Профессионал (BTR 1500+)
4.5 - Продвинутый+ (BTR 1400-1499)
4.0 - Продвинутый (BTR 1300-1399)
3.5 - Средний+ (BTR 1200-1299)
3.0 - Средний (BTR 1100-1199)
2.5 - Начинающий+ (BTR 1000-1099)
2.0 - Начинающий (BTR 900-999)
1.5 - Новичок+ (BTR 800-899)
1.0 - Новичок (BTR <800)
```

### Характеристики уровней

**5.0 - Профессионал:**
- Участие в международных турнирах
- Стабильная техника всех ударов
- Тактическое мышление
- Физическая выносливость

**4.0 - Продвинутый:**
- Уверенная игра на сетке
- Разнообразие ударов
- Понимание тактики
- Регулярные тренировки

**3.0 - Средний:**
- Базовая техника ударов
- Понимание правил
- Игра в парах
- Участие в любительских турнирах

**2.0 - Начинающий:**
- Освоение базовых ударов
- Знание правил
- Первые турниры

**1.0 - Новичок:**
- Первые шаги в пляжном теннисе
- Изучение правил

---

## Модель данных

### Player.current_rating

```python
class Player(models.Model):
    current_rating = models.IntegerField(default=1000)  # BP рейтинг * 1000
    btr_rating = models.IntegerField(null=True)         # BTR рейтинг (если есть)
```

**Хранение:** Рейтинг хранится как целое число (умноженное на 1000):
- 5.0 → 5000
- 4.5 → 4500
- 3.0 → 3000

**Отображение:**
```python
def get_bp_rating(self) -> float:
    return self.current_rating / 1000.0
```

### PlayerRatingHistory

```python
class PlayerRatingHistory(models.Model):
    player = models.ForeignKey(Player, related_name='rating_history')
    old_rating = models.IntegerField()
    new_rating = models.IntegerField()
    change_reason = models.CharField(max_length=255)
    tournament = models.ForeignKey(Tournament, null=True)
    match = models.ForeignKey(Match, null=True)
    changed_at = models.DateTimeField(auto_now_add=True)
```

**Причины изменения:**
- `"tournament_result"` - результат турнира
- `"manual_adjustment"` - ручная корректировка
- `"btr_sync"` - синхронизация с BTR
- `"initial_rating"` - начальный рейтинг

---

## Расчет рейтинга

### Алгоритм обновления

**После завершения турнира:**
```python
def update_ratings_after_tournament(tournament: Tournament):
    """
    Обновить рейтинги участников после турнира.
    
    Алгоритм:
    1. Определить победителей и призеров
    2. Рассчитать изменение рейтинга
    3. Применить изменения
    4. Сохранить историю
    """
    entries = tournament.entries.select_related('team__player_1', 'team__player_2')
    
    for entry in entries:
        old_rating = entry.team.player_1.current_rating
        
        # Расчет нового рейтинга
        new_rating = calculate_new_rating(
            old_rating=old_rating,
            place=entry.final_place,
            tournament_level=tournament.level,
            participants_count=entries.count()
        )
        
        # Применить изменение
        player = entry.team.player_1
        player.current_rating = new_rating
        player.save()
        
        # Сохранить историю
        PlayerRatingHistory.objects.create(
            player=player,
            old_rating=old_rating,
            new_rating=new_rating,
            change_reason='tournament_result',
            tournament=tournament
        )
```

### Формула расчета

```python
def calculate_new_rating(
    old_rating: int,
    place: int,
    tournament_level: str,
    participants_count: int
) -> int:
    """
    Рассчитать новый рейтинг.
    
    Факторы:
    - Текущий рейтинг
    - Занятое место
    - Уровень турнира (любительский/профессиональный)
    - Количество участников
    """
    # Базовое изменение
    if place == 1:
        delta = 100  # +0.1
    elif place == 2:
        delta = 75   # +0.075
    elif place == 3:
        delta = 50   # +0.05
    elif place <= 8:
        delta = 25   # +0.025
    else:
        delta = 0
    
    # Коэффициент уровня турнира
    level_multiplier = {
        'amateur': 1.0,
        'semi_pro': 1.5,
        'professional': 2.0
    }.get(tournament_level, 1.0)
    
    # Коэффициент размера турнира
    size_multiplier = 1.0
    if participants_count >= 32:
        size_multiplier = 1.5
    elif participants_count >= 16:
        size_multiplier = 1.25
    
    # Итоговое изменение
    total_delta = int(delta * level_multiplier * size_multiplier)
    
    # Ограничение роста для высоких рейтингов
    if old_rating >= 4500:  # BP 4.5+
        total_delta = int(total_delta * 0.5)
    
    new_rating = old_rating + total_delta
    
    # Ограничения
    new_rating = max(1000, min(5000, new_rating))  # 1.0 - 5.0
    
    return new_rating
```

---

## Конвертация BTR → BP

### Таблица соответствия

```python
BTR_TO_BP_MAPPING = {
    1500: 5000,  # 5.0
    1400: 4500,  # 4.5
    1300: 4000,  # 4.0
    1200: 3500,  # 3.5
    1100: 3000,  # 3.0
    1000: 2500,  # 2.5
    900:  2000,  # 2.0
    800:  1500,  # 1.5
    0:    1000,  # 1.0
}

def btr_to_bp(btr_rating: int) -> int:
    """Конвертировать BTR рейтинг в BP"""
    for threshold, bp_rating in sorted(BTR_TO_BP_MAPPING.items(), reverse=True):
        if btr_rating >= threshold:
            return bp_rating
    return 1000  # По умолчанию 1.0
```

### Автоматическая синхронизация

```python
def sync_btr_to_bp(player: Player):
    """
    Синхронизировать BTR рейтинг с BP.
    
    Вызывается:
    - При создании игрока
    - При обновлении BTR рейтинга
    - По расписанию (ежедневно)
    """
    if not player.btr_rating:
        return
    
    old_bp = player.current_rating
    new_bp = btr_to_bp(player.btr_rating)
    
    if old_bp != new_bp:
        player.current_rating = new_bp
        player.save()
        
        PlayerRatingHistory.objects.create(
            player=player,
            old_rating=old_bp,
            new_rating=new_bp,
            change_reason='btr_sync'
        )
```

---

## API Endpoints

### GET /api/players/{id}/rating/

Получить текущий рейтинг игрока.

**Response:**
```json
{
  "player_id": 123,
  "bp_rating": 3.5,
  "btr_rating": 1250,
  "last_updated": "2024-07-15T10:30:00Z"
}
```

### GET /api/players/{id}/rating/history/

Получить историю изменений рейтинга.

**Response:**
```json
{
  "player_id": 123,
  "history": [
    {
      "date": "2024-07-15",
      "old_rating": 3.0,
      "new_rating": 3.5,
      "change": "+0.5",
      "reason": "tournament_result",
      "tournament_name": "Кубок города"
    },
    {
      "date": "2024-06-20",
      "old_rating": 2.5,
      "new_rating": 3.0,
      "change": "+0.5",
      "reason": "tournament_result",
      "tournament_name": "Летний турнир"
    }
  ]
}
```

---

## Frontend

### Отображение рейтинга

**В профиле игрока:**
```tsx
<div className="player-rating">
  <div className="bp-rating">
    <label>BP Рейтинг</label>
    <span className="rating-value">{player.bp_rating.toFixed(1)}</span>
  </div>
  {player.btr_rating && (
    <div className="btr-rating">
      <label>BTR Рейтинг</label>
      <span className="rating-value">{player.btr_rating}</span>
    </div>
  )}
</div>
```

**График истории:**
```tsx
<RatingChart 
  data={player.rating_history}
  xKey="date"
  yKey="rating"
  title="История рейтинга BP"
/>
```

### Цветовая индикация

```css
.rating-5-0 { color: #d4af37; } /* Золотой */
.rating-4-5 { color: #c0c0c0; } /* Серебряный */
.rating-4-0 { color: #cd7f32; } /* Бронзовый */
.rating-3-5 { color: #4a90e2; } /* Синий */
.rating-3-0 { color: #50c878; } /* Зеленый */
.rating-2-5 { color: #ffa500; } /* Оранжевый */
.rating-2-0 { color: #ff6b6b; } /* Красный */
.rating-1-5 { color: #95a5a6; } /* Серый */
.rating-1-0 { color: #7f8c8d; } /* Темно-серый */
```

---

## Ручная корректировка

### Через админку Django

```python
# admin.py
@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    actions = ['adjust_rating']
    
    def adjust_rating(self, request, queryset):
        # Форма для ввода нового рейтинга
        pass
```

### Через API (только ADMIN)

**POST /api/players/{id}/adjust_rating/**

```json
{
  "new_rating": 4.0,
  "reason": "Корректировка после апелляции"
}
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
