# Статистика игрока

## Описание
Детальная статистика по каждому игроку: матчи, победы, турниры, динамика рейтинга.

## Файлы
- Backend: `apps/players/services/stats.py`, `apps/players/api_views.py`
- Frontend: `frontend/src/pages/PlayerCardPage.tsx`, `components/PlayerStatsPanel.tsx`
- Models: Агрегация из `Match`, `Tournament`, `Player`

## API

### GET /api/players/{id}/stats/
```json
{
  "total_matches": 45,
  "wins": 28,
  "losses": 17,
  "win_rate": 62.2,
  "tournaments_played": 12,
  "sets_won": 58,
  "sets_lost": 40,
  "avg_sets_per_match": 2.2
}
```

### GET /api/players/{id}/matches/?limit=10
История последних матчей

## Метрики
- **Win Rate** - процент побед
- **Tournaments Played** - сыгранные турниры
- **Total Matches** - всего матчей
- **Sets Won/Lost** - выигранные/проигранные сеты
- **Points Won/Lost** - очки
- **Current Streak** - текущая серия побед/поражений

## UI/UX
- Карточка игрока с фото
- Графики статистики
- История матчей с фильтрами
- Сравнение с другими игроками
- Динамика рейтинга (график)

## Расчет
```python
def calculate_player_stats(player_id):
    matches = Match.objects.filter(
        Q(team_1__player_1=player) | Q(team_1__player_2=player) |
        Q(team_2__player_1=player) | Q(team_2__player_2=player),
        status='completed'
    )
    
    wins = matches.filter(winner_team__players=player).count()
    total = matches.count()
    win_rate = (wins / total * 100) if total > 0 else 0
    
    return {
        'total_matches': total,
        'wins': wins,
        'win_rate': round(win_rate, 1)
    }
```
