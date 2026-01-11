# Управление командами - Детальная документация

## Описание

Модуль управления командами отвечает за создание и управление парами игроков. Поддерживает как одиночные команды (singles), так и пары (doubles).

---

## Модель Team

```python
class Team(models.Model):
    player_1 = models.ForeignKey(Player, related_name="teams_as_p1")
    player_2 = models.ForeignKey(Player, related_name="teams_as_p2", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

### Типы команд

**1. Singles (одиночка):**
```python
team = Team(player_1=player, player_2=None)
# Отображение: "Иванов Иван"
```

**2. Doubles (пара):**
```python
team = Team(player_1=player1, player_2=player2)
# Отображение: "Иванов Иван / Петров Петр"
```

### Constraints (ограничения)

**1. Запрет одинакового игрока:**
```python
models.CheckConstraint(
    check=~Q(player_1=F("player_2")),
    name="team_no_same_players"
)
# Нельзя: Team(player_1=player, player_2=player)
```

**2. Уникальность пары:**
```python
models.UniqueConstraint(
    fields=["player_1", "player_2"],
    name="unique_team_pair",
    condition=Q(player_2__isnull=False)
)
# Нельзя создать дубликат пары [A, B]
```

**3. Уникальность одиночки:**
```python
models.UniqueConstraint(
    fields=["player_1"],
    name="unique_single_player_team",
    condition=Q(player_2__isnull=True)
)
# У каждого игрока только одна singles команда
```

---

## Виртуальные команды для King

### Зачем нужны

В King системе пары формируются динамически каждый раунд. Для каждой комбинации игроков создается виртуальная Team.

### Создание виртуальной команды

```python
def create_virtual_team(player1: Player, player2: Player) -> Team:
    """
    Создать или получить виртуальную команду для пары игроков.
    
    Важно: player_1 и player_2 сортируются по ID для уникальности.
    """
    # Сортировка для уникальности
    p1, p2 = sorted([player1, player2], key=lambda p: p.id)
    
    # Создать или получить
    team, created = Team.objects.get_or_create(
        player_1=p1,
        player_2=p2
    )
    
    return team
```

### Пример для King турнира

```python
# Раунд 1: [Игрок A, Игрок B] vs [Игрок C, Игрок D]
team1 = create_virtual_team(player_a, player_b)  # Team(A, B)
team2 = create_virtual_team(player_c, player_d)  # Team(C, D)

# Раунд 2: [Игрок A, Игрок C] vs [Игрок B, Игрок D]
team3 = create_virtual_team(player_a, player_c)  # Team(A, C) - новая
team4 = create_virtual_team(player_b, player_d)  # Team(B, D) - новая
```

---

## API Endpoints

### GET /api/teams/

Список всех команд.

**Response:**
```json
{
  "count": 50,
  "results": [
    {
      "id": 1,
      "player_1": {
        "id": 10,
        "name": "Иванов Иван"
      },
      "player_2": {
        "id": 11,
        "name": "Петров Петр"
      },
      "is_singles": false,
      "display_name": "Иванов И. / Петров П.",
      "created_at": "2024-07-01T10:00:00Z"
    }
  ]
}
```

### POST /api/teams/

Создать новую команду.

**Request (пара):**
```json
{
  "player_1_id": 10,
  "player_2_id": 11
}
```

**Request (одиночка):**
```json
{
  "player_1_id": 10,
  "player_2_id": null
}
```

**Response:**
```json
{
  "id": 1,
  "player_1": {...},
  "player_2": {...},
  "is_singles": false,
  "display_name": "Иванов И. / Петров П."
}
```

### GET /api/teams/{id}/

Детальная информация о команде.

**Response:**
```json
{
  "id": 1,
  "player_1": {
    "id": 10,
    "name": "Иванов Иван",
    "rating": 3500
  },
  "player_2": {
    "id": 11,
    "name": "Петров Петр",
    "rating": 3200
  },
  "is_singles": false,
  "combined_rating": 6700,
  "tournaments_played": 15,
  "matches_won": 25,
  "matches_lost": 10,
  "win_rate": 0.71
}
```

### DELETE /api/teams/{id}/

Удалить команду (только если нет связанных матчей).

---

## Расчет рейтинга команды

### Для пар

```python
def get_team_rating(team: Team) -> int:
    """
    Рассчитать рейтинг команды.
    
    Для пар: среднее арифметическое рейтингов с округлением до целых
    Для одиночек: рейтинг игрока
    """
    if team.player_1 and team.player_2:
        r1 = team.player_1.current_rating or 0
        r2 = team.player_2.current_rating or 0
        return round((r1 + r2) / 2)
    elif team.player_1:
        return team.player_1.current_rating or 0
    
    return 0
```

**Примеры:**
```python
# Пара
team = Team(player_1=Player(rating=3500), player_2=Player(rating=3200))
get_team_rating(team)  # 3350 = round((3500 + 3200) / 2)

# Одиночка
team = Team(player_1=Player(rating=3500), player_2=None)
get_team_rating(team)  # 3500
```

### Для посева в турнирах

```python
def sort_teams_by_rating(teams: List[Team]) -> List[Team]:
    """Сортировка команд по рейтингу для посева"""
    return sorted(teams, key=lambda t: get_team_rating(t), reverse=True)
```

---

## Статистика команды

### Расчет статистики

```python
def calculate_team_stats(team: Team) -> Dict:
    """Рассчитать статистику команды"""
    matches = Match.objects.filter(
        Q(team_1=team) | Q(team_2=team),
        status='completed'
    )
    
    wins = matches.filter(winner=team).count()
    total = matches.count()
    
    tournaments = Tournament.objects.filter(
        entries__team=team
    ).distinct()
    
    return {
        'tournaments_played': tournaments.count(),
        'matches_played': total,
        'matches_won': wins,
        'matches_lost': total - wins,
        'win_rate': wins / total if total > 0 else 0,
    }
```

---

## Поиск команд

### По игрокам

```python
def find_team_by_players(player1: Player, player2: Player = None) -> Optional[Team]:
    """
    Найти команду по игрокам.
    
    Учитывает порядок игроков (A/B == B/A).
    """
    if player2 is None:
        # Одиночка
        return Team.objects.filter(
            player_1=player1,
            player_2__isnull=True
        ).first()
    
    # Пара (любой порядок)
    return Team.objects.filter(
        Q(player_1=player1, player_2=player2) |
        Q(player_1=player2, player_2=player1)
    ).first()
```

### По турниру

```python
def get_tournament_teams(tournament: Tournament) -> QuerySet[Team]:
    """Получить все команды турнира"""
    return Team.objects.filter(
        entries__tournament=tournament
    ).distinct()
```

---

## Frontend компоненты

### Отображение команды

```tsx
interface TeamDisplayProps {
  team: Team;
  showRating?: boolean;
}

const TeamDisplay: React.FC<TeamDisplayProps> = ({ team, showRating }) => {
  return (
    <div className="team-display">
      <div className="team-name">
        {team.player_1.display_name}
        {team.player_2 && (
          <>
            <span className="separator"> / </span>
            {team.player_2.display_name}
          </>
        )}
      </div>
      {showRating && (
        <div className="team-rating">
          {team.combined_rating / 1000}
        </div>
      )}
    </div>
  );
};
```

### Создание команды

```tsx
const CreateTeamModal: React.FC = () => {
  const [player1, setPlayer1] = useState<Player | null>(null);
  const [player2, setPlayer2] = useState<Player | null>(null);
  const [isSingles, setIsSingles] = useState(false);
  
  const handleSubmit = async () => {
    const data = {
      player_1_id: player1?.id,
      player_2_id: isSingles ? null : player2?.id
    };
    
    await api.post('/teams/', data);
  };
  
  return (
    <Modal>
      <PlayerSelect value={player1} onChange={setPlayer1} label="Игрок 1" />
      
      <Checkbox checked={isSingles} onChange={setIsSingles}>
        Одиночка
      </Checkbox>
      
      {!isSingles && (
        <PlayerSelect value={player2} onChange={setPlayer2} label="Игрок 2" />
      )}
      
      <Button onClick={handleSubmit}>Создать</Button>
    </Modal>
  );
};
```

---

## Валидация

### Backend валидация

```python
def validate_team(player_1: Player, player_2: Player = None) -> List[str]:
    """
    Валидация команды перед созданием.
    
    Returns:
        Список ошибок (пустой если всё ок)
    """
    errors = []
    
    # 1. Проверка одинаковых игроков
    if player_2 and player_1.id == player_2.id:
        errors.append("Игроки в паре должны быть разными")
    
    # 2. Проверка существования
    if player_2:
        existing = Team.objects.filter(
            Q(player_1=player_1, player_2=player_2) |
            Q(player_1=player_2, player_2=player_1)
        ).exists()
        if existing:
            errors.append("Такая пара уже существует")
    else:
        existing = Team.objects.filter(
            player_1=player_1,
            player_2__isnull=True
        ).exists()
        if existing:
            errors.append("Команда-одиночка для этого игрока уже существует")
    
    # 3. Проверка пола для смешанных турниров
    if player_2 and player_1.gender == player_2.gender:
        # Это нормально для парных турниров
        pass
    
    return errors
```

---

## Удаление команд

### Проверка перед удалением

```python
def can_delete_team(team: Team) -> Tuple[bool, str]:
    """
    Проверить можно ли удалить команду.
    
    Returns:
        (можно_удалить, причина_если_нельзя)
    """
    # Проверить матчи
    matches_count = Match.objects.filter(
        Q(team_1=team) | Q(team_2=team)
    ).count()
    
    if matches_count > 0:
        return False, f"Команда участвует в {matches_count} матчах"
    
    # Проверить турниры
    tournaments_count = TournamentEntry.objects.filter(team=team).count()
    
    if tournaments_count > 0:
        return False, f"Команда зарегистрирована в {tournaments_count} турнирах"
    
    return True, ""
```

### Безопасное удаление

```python
@transaction.atomic
def safe_delete_team(team: Team) -> bool:
    """
    Безопасно удалить команду.
    
    Returns:
        True если удалена, False если нельзя удалить
    """
    can_delete, reason = can_delete_team(team)
    
    if not can_delete:
        raise ValueError(reason)
    
    team.delete()
    return True
```

---

**Версия:** 1.0  
**Дата:** 5 января 2026
