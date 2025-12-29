# Управление матчами

## Описание
Управление матчами: создание, ввод счета, статусы, специальные исходы (walkover, disqualification).

## Файлы
- Backend: `apps/matches/models.py`, `apps/matches/api_views.py`, `apps/matches/services/match.py`
- Frontend: `frontend/src/components/MatchScoreDialog.tsx`, `components/MatchActionDialog.tsx`
- Models: `Match`, `MatchSet`, `MatchSpecialOutcome`

## API

### POST /api/matches/{id}/start/
Начать матч (проверка занятости участников)

### POST /api/matches/{id}/update_score/
Обновить счет
```json
{
  "sets": [
    {"team_1_score": 6, "team_2_score": 4},
    {"team_1_score": 6, "team_2_score": 3}
  ]
}
```

### POST /api/matches/{id}/cancel/
Отменить матч

### DELETE /api/matches/{id}/
Удалить матч (только завершенные)

## Модель Match
```python
class Match(models.Model):
    tournament = ForeignKey(Tournament)
    team_1 = ForeignKey(Team, null=True)
    team_2 = ForeignKey(Team, null=True)
    status = CharField(choices=[
        ('scheduled', 'Запланирован'),
        ('in_progress', 'Идет'),
        ('completed', 'Завершен'),
        ('cancelled', 'Отменен')
    ])
    winner_team = ForeignKey(Team, null=True)
    round_index = IntegerField()
    group_index = IntegerField(null=True)
    order_in_round = IntegerField(null=True)
    started_at = DateTimeField(null=True)
    completed_at = DateTimeField(null=True)
```

## Модель MatchSet
```python
class MatchSet(models.Model):
    match = ForeignKey(Match)
    set_number = IntegerField()
    team_1_score = IntegerField()
    team_2_score = IntegerField()
    is_tiebreak = BooleanField(default=False)
```

## Логика

**Начало матча:**
```python
def start_match(match_id):
    # 1. Проверить что участники не заняты
    # 2. Установить status='in_progress'
    # 3. Установить started_at=now()
```

**Ввод счета:**
```python
def update_score(match_id, sets):
    # 1. Удалить старые сеты
    # 2. Создать новые MatchSet
    # 3. Определить победителя
    # 4. Установить status='completed'
    # 5. Установить completed_at=now()
    # 6. Обновить статистику участников
```

**Проверка занятости:**
```python
def check_availability(team):
    # Проверить нет ли матчей со status='in_progress'
    # для игроков этой команды
```

## UI/UX
- Диалог ввода счета с валидацией
- Три состояния: не начат, идет, завершен
- Зеленый фон для live матчей
- Красный кружок перед счетом
- Hover эффекты

## Валидация счета
- Минимум 1 сет
- Максимум 3 сета (для best_of_3)
- Счет сета: 6-0 до 7-6
- Тай-брейк: минимум 7 очков, разница 2
