# Управление командами

## Описание
Создание и управление командами (пары или одиночки) для участия в турнирах.

## Файлы
- Backend: `apps/teams/models.py`, `apps/teams/api_views.py`
- Frontend: `frontend/src/components/TeamPicker.tsx`, `components/TeamDisplay.tsx`
- Models: `Team`

## API

### GET /api/teams/
Список команд
```
?player_id=5  # Команды с участием игрока
&tournament_id=10  # Команды турнира
```

### POST /api/teams/
Создать команду
```json
{
  "player_1_id": 5,
  "player_2_id": 8  // null для одиночки
}
```

### GET /api/teams/{id}/
Детали команды

## Модель Team
```python
class Team(models.Model):
    player_1 = ForeignKey(Player, related_name='teams_as_player_1')
    player_2 = ForeignKey(Player, null=True, related_name='teams_as_player_2')
    
    @property
    def name(self):
        if self.player_2:
            return f"{self.player_1.display_name}/{self.player_2.display_name}"
        return self.player_1.display_name
    
    @property
    def avg_rating(self):
        if self.player_2:
            return (self.player_1.current_rating + self.player_2.current_rating) / 2
        return self.player_1.current_rating
```

## UI/UX
- TeamPicker: выбор игроков для команды
- Автодополнение при вводе имени
- Отображение рейтинга команды
- Проверка дублей (та же пара уже существует)

## Логика
- Автоматическое создание при регистрации на турнир
- Проверка доступности игроков (не заняты в других матчах)
- Расчет среднего рейтинга для пары
