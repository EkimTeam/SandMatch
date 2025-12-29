# Статистика игрока - Детальная документация

## Описание

Модуль расчета и отображения детальной статистики игроков, включая турниры, матчи, Head-to-Head сравнения и историю рейтинга.

---

## Модель PlayerRatingHistory

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

---

## Расчет статистики

### Общая статистика

```python
def calculate_player_stats(player: Player) -> Dict:
    """
    Рассчитать общую статистику игрока.
    
    Включает:
    - Турниры (всего, победы, призовые места)
    - Матчи (всего, победы, поражения, процент побед)
    - Серии (текущая серия побед/поражений)
    - Рейтинг (текущий, максимальный, минимальный)
    """
    # Турниры
    tournaments = Tournament.objects.filter(
        entries__team__player_1=player
    ).distinct()
    
    tournaments_won = tournaments.filter(
        entries__final_place=1,
        entries__team__player_1=player
    ).count()
    
    tournaments_top3 = tournaments.filter(
        entries__final_place__lte=3,
        entries__team__player_1=player
    ).count()
    
    # Матчи
    matches = Match.objects.filter(
        Q(team_1__player_1=player) | Q(team_2__player_1=player),
        status='completed'
    )
    
    wins = matches.filter(winner__player_1=player).count()
    total_matches = matches.count()
    losses = total_matches - wins
    
    # Серия
    current_streak = calculate_current_streak(player)
    
    # Рейтинг
    rating_history = PlayerRatingHistory.objects.filter(
        player=player
    ).order_by('changed_at')
    
    max_rating = max([h.new_rating for h in rating_history]) if rating_history else player.current_rating
    min_rating = min([h.new_rating for h in rating_history]) if rating_history else player.current_rating
    
    return {
        'tournaments': {
            'total': tournaments.count(),
            'won': tournaments_won,
            'top3': tournaments_top3,
        },
        'matches': {
            'total': total_matches,
            'won': wins,
            'lost': losses,
            'win_rate': wins / total_matches if total_matches > 0 else 0,
        },
        'streak': current_streak,
        'rating': {
            'current': player.current_rating,
            'max': max_rating,
            'min': min_rating,
        }
    }
```

### Серия побед/поражений

```python
def calculate_current_streak(player: Player) -> Dict:
    """
    Рассчитать текущую серию побед или поражений.
    
    Returns:
        {
            'type': 'win' | 'loss',
            'count': int
        }
    """
    # Получить последние матчи
    recent_matches = Match.objects.filter(
        Q(team_1__player_1=player) | Q(team_2__player_1=player),
        status='completed'
    ).order_by('-finished_at')[:20]
    
    if not recent_matches:
        return {'type': None, 'count': 0}
    
    # Определить тип серии по последнему матчу
    last_match = recent_matches[0]
    is_winner = last_match.winner and last_match.winner.player_1 == player
    streak_type = 'win' if is_winner else 'loss'
    
    # Подсчитать длину серии
    count = 0
    for match in recent_matches:
        match_is_win = match.winner and match.winner.player_1 == player
        
        if (streak_type == 'win' and match_is_win) or (streak_type == 'loss' and not match_is_win):
            count += 1
        else:
            break
    
    return {'type': streak_type, 'count': count}
```

### Статистика по турнирным системам

```python
def calculate_stats_by_system(player: Player) -> Dict:
    """Статистика по типам турниров"""
    systems = ['round_robin', 'knockout', 'king']
    stats = {}
    
    for system in systems:
        tournaments = Tournament.objects.filter(
            system=system,
            entries__team__player_1=player
        ).distinct()
        
        matches = Match.objects.filter(
            Q(team_1__player_1=player) | Q(team_2__player_1=player),
            tournament__system=system,
            status='completed'
        )
        
        wins = matches.filter(winner__player_1=player).count()
        total = matches.count()
        
        stats[system] = {
            'tournaments': tournaments.count(),
            'matches': total,
            'wins': wins,
            'win_rate': wins / total if total > 0 else 0
        }
    
    return stats
```

---

## Head-to-Head (H2H)

### Расчет H2H

```python
def calculate_h2h(player1: Player, player2: Player) -> Dict:
    """
    Рассчитать статистику личных встреч двух игроков.
    
    Returns:
        {
            'total_matches': int,
            'player1_wins': int,
            'player2_wins': int,
            'matches': List[Match]
        }
    """
    # Найти все матчи между игроками
    matches = Match.objects.filter(
        Q(team_1__player_1=player1, team_2__player_1=player2) |
        Q(team_1__player_1=player2, team_2__player_1=player1) |
        Q(team_1__player_2=player1, team_2__player_2=player2) |
        Q(team_1__player_2=player2, team_2__player_2=player1),
        status='completed'
    ).order_by('-finished_at')
    
    # Подсчитать победы
    player1_wins = 0
    player2_wins = 0
    
    for match in matches:
        if not match.winner:
            continue
        
        winner_players = [match.winner.player_1, match.winner.player_2]
        
        if player1 in winner_players:
            player1_wins += 1
        elif player2 in winner_players:
            player2_wins += 1
    
    return {
        'total_matches': matches.count(),
        'player1_wins': player1_wins,
        'player2_wins': player2_wins,
        'matches': list(matches)
    }
```

### Детальная история H2H

```python
def get_h2h_details(player1: Player, player2: Player) -> List[Dict]:
    """Детальная история встреч"""
    h2h = calculate_h2h(player1, player2)
    
    details = []
    for match in h2h['matches']:
        # Определить команды и счет
        team1_has_player1 = player1 in [match.team_1.player_1, match.team_1.player_2]
        
        if team1_has_player1:
            player1_team = match.team_1
            player2_team = match.team_2
        else:
            player1_team = match.team_2
            player2_team = match.team_1
        
        # Форматировать счет
        score = format_match_score(match)
        
        # Определить победителя
        winner = None
        if match.winner == player1_team:
            winner = player1
        elif match.winner == player2_team:
            winner = player2
        
        details.append({
            'date': match.finished_at,
            'tournament': match.tournament.name,
            'player1_team': str(player1_team),
            'player2_team': str(player2_team),
            'score': score,
            'winner': winner
        })
    
    return details
```

---

## API Endpoints

### GET /api/players/{id}/stats/

Получить статистику игрока.

```json
Response:
{
  "player": {
    "id": 10,
    "name": "Иванов Иван",
    "current_rating": 3500
  },
  "tournaments": {
    "total": 25,
    "won": 3,
    "top3": 8
  },
  "matches": {
    "total": 150,
    "won": 98,
    "lost": 52,
    "win_rate": 0.653
  },
  "streak": {
    "type": "win",
    "count": 5
  },
  "rating": {
    "current": 3500,
    "max": 3800,
    "min": 2500
  },
  "by_system": {
    "round_robin": {
      "tournaments": 10,
      "matches": 60,
      "wins": 40,
      "win_rate": 0.667
    },
    "knockout": {
      "tournaments": 12,
      "matches": 70,
      "wins": 45,
      "win_rate": 0.643
    },
    "king": {
      "tournaments": 3,
      "matches": 20,
      "wins": 13,
      "win_rate": 0.65
    }
  }
}
```

### GET /api/players/{id}/rating-history/

История изменения рейтинга.

```json
Response:
{
  "history": [
    {
      "date": "2024-07-15",
      "old_rating": 3000,
      "new_rating": 3500,
      "change": "+500",
      "reason": "tournament_result",
      "tournament": "Кубок города"
    },
    {
      "date": "2024-06-20",
      "old_rating": 2500,
      "new_rating": 3000,
      "change": "+500",
      "reason": "tournament_result",
      "tournament": "Летний турнир"
    }
  ]
}
```

### GET /api/players/h2h/?player1={id1}&player2={id2}

Head-to-Head статистика.

```json
Response:
{
  "player1": {
    "id": 10,
    "name": "Иванов Иван"
  },
  "player2": {
    "id": 11,
    "name": "Петров Петр"
  },
  "total_matches": 8,
  "player1_wins": 5,
  "player2_wins": 3,
  "matches": [
    {
      "date": "2024-07-15",
      "tournament": "Кубок города",
      "player1_team": "Иванов И. / Сидоров С.",
      "player2_team": "Петров П. / Козлов К.",
      "score": "6:4, 7:6(7:5)",
      "winner": "Иванов Иван"
    }
  ]
}
```

---

## Frontend компоненты

### StatsPage.tsx

```tsx
const StatsPage: React.FC = () => {
  const { id } = useParams();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  
  useEffect(() => {
    api.get(`/players/${id}/stats/`).then(res => setStats(res.data));
  }, [id]);
  
  if (!stats) return <Loading />;
  
  return (
    <div className="stats-page">
      <PlayerHeader player={stats.player} />
      
      <StatsGrid>
        <StatCard title="Турниры" value={stats.tournaments.total} />
        <StatCard title="Победы" value={stats.tournaments.won} />
        <StatCard title="Матчи" value={stats.matches.total} />
        <StatCard title="% побед" value={`${(stats.matches.win_rate * 100).toFixed(1)}%`} />
      </StatsGrid>
      
      {stats.streak.count > 0 && (
        <StreakBadge type={stats.streak.type} count={stats.streak.count} />
      )}
      
      <RatingChart history={stats.rating_history} />
      
      <SystemStats data={stats.by_system} />
    </div>
  );
};
```

### H2HPage.tsx

```tsx
const H2HPage: React.FC = () => {
  const [player1, setPlayer1] = useState<Player | null>(null);
  const [player2, setPlayer2] = useState<Player | null>(null);
  const [h2h, setH2H] = useState<H2HData | null>(null);
  
  const loadH2H = async () => {
    if (!player1 || !player2) return;
    
    const res = await api.get(`/players/h2h/?player1=${player1.id}&player2=${player2.id}`);
    setH2H(res.data);
  };
  
  return (
    <div className="h2h-page">
      <h1>Head-to-Head</h1>
      
      <PlayerSelect value={player1} onChange={setPlayer1} />
      <span className="vs">VS</span>
      <PlayerSelect value={player2} onChange={setPlayer2} />
      
      <Button onClick={loadH2H}>Сравнить</Button>
      
      {h2h && (
        <>
          <H2HSummary data={h2h} />
          <MatchHistory matches={h2h.matches} />
        </>
      )}
    </div>
  );
};
```

### RatingChart.tsx

```tsx
import { Line } from 'react-chartjs-2';

const RatingChart: React.FC<{ history: RatingHistory[] }> = ({ history }) => {
  const data = {
    labels: history.map(h => new Date(h.date).toLocaleDateString('ru-RU')),
    datasets: [{
      label: 'Рейтинг BP',
      data: history.map(h => h.new_rating / 1000),
      borderColor: '#4a90e2',
      backgroundColor: 'rgba(74, 144, 226, 0.1)',
      tension: 0.4
    }]
  };
  
  const options = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `Рейтинг: ${context.parsed.y.toFixed(1)}`
        }
      }
    },
    scales: {
      y: {
        min: 1.0,
        max: 5.0,
        ticks: { stepSize: 0.5 }
      }
    }
  };
  
  return <Line data={data} options={options} />;
};
```

---

## Экспорт статистики

### PDF экспорт

```python
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

def export_player_stats_pdf(player: Player) -> bytes:
    """Экспортировать статистику игрока в PDF"""
    buffer = BytesIO()
    p = canvas.Canvas(buffer, pagesize=A4)
    
    # Заголовок
    p.setFont("Helvetica-Bold", 16)
    p.drawString(100, 800, f"Статистика игрока: {player}")
    
    # Статистика
    stats = calculate_player_stats(player)
    
    y = 750
    p.setFont("Helvetica", 12)
    p.drawString(100, y, f"Турниров сыграно: {stats['tournaments']['total']}")
    y -= 20
    p.drawString(100, y, f"Турниров выиграно: {stats['tournaments']['won']}")
    y -= 20
    p.drawString(100, y, f"Матчей сыграно: {stats['matches']['total']}")
    y -= 20
    p.drawString(100, y, f"Процент побед: {stats['matches']['win_rate']:.1%}")
    
    p.showPage()
    p.save()
    
    return buffer.getvalue()
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
