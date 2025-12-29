# Управление матчами - Детальная документация

## Описание

Модуль управления матчами отвечает за создание, проведение и завершение матчей. Поддерживает различные статусы, ввод счета по сетам и специальные исходы.

---

## Модель Match

```python
class Match(models.Model):
    # Связи
    tournament = models.ForeignKey(Tournament, related_name="matches")
    bracket = models.ForeignKey(KnockoutBracket, null=True)  # Для Knockout
    team_1 = models.ForeignKey(Team, related_name="matches_as_team1", null=True)
    team_2 = models.ForeignKey(Team, related_name="matches_as_team2", null=True)
    winner = models.ForeignKey(Team, related_name="wins", null=True)
    
    # Нормализация для уникальности
    team_low = models.ForeignKey(Team, related_name="matches_as_team_low", null=True)
    team_high = models.ForeignKey(Team, related_name="matches_as_team_high", null=True)
    
    # Структура турнира
    stage = models.CharField(choices=Stage.choices, default='group')
    group_index = models.PositiveSmallIntegerField(null=True)
    round_index = models.PositiveSmallIntegerField(null=True)
    round_name = models.CharField(max_length=50, null=True)
    order_in_round = models.IntegerField(default=0)
    is_third_place = models.BooleanField(default=False)
    
    # Статус и время
    status = models.CharField(choices=Status.choices, default='scheduled')
    scheduled_time = models.DateTimeField(null=True)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
```

### Статусы матча

```python
class Status(models.TextChoices):
    SCHEDULED = "scheduled", "Запланирован"
    LIVE = "live", "Идёт"
    COMPLETED = "completed", "Завершён"
    WALKOVER = "walkover", "Неявка"
    RETIRED = "retired", "Снятие"
    DEFAULT = "default", "Дисквалификация"
```

### Стадии турнира

```python
class Stage(models.TextChoices):
    GROUP = "group", "Групповой этап"
    PLAYOFF = "playoff", "Плей-офф"
    PLACEMENT = "placement", "Классификация"
```

---

## Модель MatchSet

```python
class MatchSet(models.Model):
    match = models.ForeignKey(Match, related_name="sets")
    index = models.PositiveSmallIntegerField()  # 1, 2, 3
    games_1 = models.PositiveSmallIntegerField(default=0)
    games_2 = models.PositiveSmallIntegerField(default=0)
    tb_1 = models.PositiveSmallIntegerField(null=True)  # Тайбрейк
    tb_2 = models.PositiveSmallIntegerField(null=True)
    is_tiebreak_only = models.BooleanField(default=False)  # Сет-тайбрейк
```

### Примеры сетов

**Обычный сет:**
```python
MatchSet(index=1, games_1=6, games_2=4)
# Отображение: "6:4"
```

**Сет с тайбрейком:**
```python
MatchSet(index=2, games_1=7, games_2=6, tb_1=7, tb_2=5)
# Отображение: "7:6(7:5)"
```

**Сет-тайбрейк (супер-тайбрейк):**
```python
MatchSet(index=3, is_tiebreak_only=True, tb_1=10, tb_2=8)
# Отображение: "TB(10:8)"
```

---

## Модель MatchSpecialOutcome

```python
class MatchSpecialOutcome(models.Model):
    class OutcomeType(models.TextChoices):
        WALKOVER = "walkover", "Неявка"
        RETIRED = "retired", "Снятие"
        DEFAULT = "default", "Дисквалификация"
    
    match = models.OneToOneField(Match, related_name="special_outcome")
    type = models.CharField(choices=OutcomeType.choices)
    retired_team = models.ForeignKey(Team, null=True)  # Кто снялся
    defaulted_team = models.ForeignKey(Team, null=True)  # Кто дисквалифицирован
    set_number = models.PositiveSmallIntegerField(null=True)  # На каком сете
    score_at_stop = models.CharField(max_length=20, null=True)  # Счет на момент остановки
```

---

## API Endpoints

### POST /api/matches/{id}/start/

Начать матч.

**Response:**
```json
{
  "id": 100,
  "status": "live",
  "started_at": "2024-07-15T14:30:00Z"
}
```

### POST /api/matches/{id}/save_score/

Ввести счет матча.

**Request:**
```json
{
  "sets": [
    {"games_1": 6, "games_2": 4},
    {"games_1": 7, "games_2": 6, "tb_1": 7, "tb_2": 5}
  ],
  "winner_id": 10
}
```

**Response:**
```json
{
  "ok": true,
  "match": {
    "id": 100,
    "status": "completed",
    "winner_id": 10,
    "sets": [
      {"index": 1, "score": "6:4"},
      {"index": 2, "score": "7:6(7:5)"}
    ],
    "finished_at": "2024-07-15T15:45:00Z"
  }
}
```

### POST /api/matches/{id}/special_outcome/

Зафиксировать специальный исход.

**Request (неявка):**
```json
{
  "type": "walkover",
  "winner_id": 10
}
```

**Request (снятие):**
```json
{
  "type": "retired",
  "retired_team_id": 11,
  "winner_id": 10,
  "set_number": 2,
  "score_at_stop": "6:4, 3:2"
}
```

---

## Логика ввода счета

### Валидация счета

```python
def validate_score(sets: List[Dict]) -> List[str]:
    """
    Валидация счета матча.
    
    Правила:
    - Минимум 2 сета (best of 3)
    - Максимум 3 сета
    - Победитель должен выиграть 2 сета
    - Счет в сете: 6:0 до 6:4, 7:5, 7:6
    - Тайбрейк при 6:6
    """
    errors = []
    
    if len(sets) < 2:
        errors.append("Минимум 2 сета")
    
    if len(sets) > 3:
        errors.append("Максимум 3 сета")
    
    # Подсчет выигранных сетов
    team1_sets = sum(1 for s in sets if s['games_1'] > s['games_2'])
    team2_sets = sum(1 for s in sets if s['games_2'] > s['games_1'])
    
    if max(team1_sets, team2_sets) < 2:
        errors.append("Победитель должен выиграть 2 сета")
    
    # Валидация каждого сета
    for i, s in enumerate(sets, 1):
        g1, g2 = s['games_1'], s['games_2']
        
        # Проверка корректности счета
        if g1 == 6 and g2 <= 4:
            continue  # 6:0, 6:1, 6:2, 6:3, 6:4 - ок
        elif g2 == 6 and g1 <= 4:
            continue
        elif g1 == 7 and g2 in [5, 6]:
            continue  # 7:5, 7:6 - ок
        elif g2 == 7 and g1 in [5, 6]:
            continue
        else:
            errors.append(f"Сет {i}: некорректный счет {g1}:{g2}")
        
        # Проверка тайбрейка
        if (g1 == 6 and g2 == 6) or (g1 == 7 and g2 == 6) or (g1 == 6 and g2 == 7):
            if 'tb_1' not in s or 'tb_2' not in s:
                errors.append(f"Сет {i}: требуется тайбрейк")
    
    return errors
```

### Сохранение счета

```python
@transaction.atomic
def save_match_score(match: Match, sets_data: List[Dict], winner_id: int):
    """Сохранить счет матча"""
    # Валидация
    errors = validate_score(sets_data)
    if errors:
        raise ValueError("; ".join(errors))
    
    # Удалить старые сеты
    match.sets.all().delete()
    
    # Создать новые сеты
    for i, set_data in enumerate(sets_data, 1):
        MatchSet.objects.create(
            match=match,
            index=i,
            games_1=set_data['games_1'],
            games_2=set_data['games_2'],
            tb_1=set_data.get('tb_1'),
            tb_2=set_data.get('tb_2'),
            is_tiebreak_only=set_data.get('is_tiebreak_only', False)
        )
    
    # Обновить матч
    match.winner_id = winner_id
    match.status = Match.Status.COMPLETED
    match.finished_at = timezone.now()
    match.save()
    
    # Продвинуть победителя (для Knockout)
    if match.bracket:
        advance_winner(match)
```

---

## Специальные исходы

### Неявка (Walkover)

```python
def register_walkover(match: Match, winner: Team):
    """
    Зафиксировать неявку.
    
    Одна из команд не явилась на матч.
    """
    MatchSpecialOutcome.objects.create(
        match=match,
        type='walkover'
    )
    
    match.winner = winner
    match.status = Match.Status.WALKOVER
    match.finished_at = timezone.now()
    match.save()
```

### Снятие (Retired)

```python
def register_retired(
    match: Match,
    retired_team: Team,
    winner: Team,
    set_number: int,
    score_at_stop: str
):
    """
    Зафиксировать снятие.
    
    Команда снялась во время матча (травма, недомогание).
    """
    MatchSpecialOutcome.objects.create(
        match=match,
        type='retired',
        retired_team=retired_team,
        set_number=set_number,
        score_at_stop=score_at_stop
    )
    
    match.winner = winner
    match.status = Match.Status.RETIRED
    match.finished_at = timezone.now()
    match.save()
```

### Дисквалификация (Default)

```python
def register_default(match: Match, defaulted_team: Team, winner: Team):
    """
    Зафиксировать дисквалификацию.
    
    Команда дисквалифицирована за нарушение правил.
    """
    MatchSpecialOutcome.objects.create(
        match=match,
        type='default',
        defaulted_team=defaulted_team
    )
    
    match.winner = winner
    match.status = Match.Status.DEFAULT
    match.finished_at = timezone.now()
    match.save()
```

---

## Frontend компоненты

### Модальное окно ввода счета

```tsx
interface ScoreModalProps {
  match: Match;
  onSave: (score: ScoreData) => void;
}

const MatchScoreModal: React.FC<ScoreModalProps> = ({ match, onSave }) => {
  const [sets, setSets] = useState<SetScore[]>([
    { games_1: 0, games_2: 0 }
  ]);
  
  const addSet = () => {
    if (sets.length < 3) {
      setSets([...sets, { games_1: 0, games_2: 0 }]);
    }
  };
  
  const handleSubmit = () => {
    // Определить победителя
    const team1Sets = sets.filter(s => s.games_1 > s.games_2).length;
    const team2Sets = sets.filter(s => s.games_2 > s.games_1).length;
    const winnerId = team1Sets > team2Sets ? match.team_1.id : match.team_2.id;
    
    onSave({ sets, winner_id: winnerId });
  };
  
  return (
    <Modal>
      <h2>Ввод счета</h2>
      {sets.map((set, i) => (
        <div key={i} className="set-input">
          <label>Сет {i + 1}</label>
          <input
            type="number"
            value={set.games_1}
            onChange={e => updateSet(i, 'games_1', e.target.value)}
          />
          <span>:</span>
          <input
            type="number"
            value={set.games_2}
            onChange={e => updateSet(i, 'games_2', e.target.value)}
          />
        </div>
      ))}
      <Button onClick={addSet}>Добавить сет</Button>
      <Button onClick={handleSubmit}>Сохранить</Button>
    </Modal>
  );
};
```

---

## Отображение счета

### Форматирование

```python
def format_match_score(match: Match) -> str:
    """
    Форматировать счет матча для отображения.
    
    Примеры:
    - "6:4, 7:6(7:5)"
    - "6:3, 4:6, 10:8"
    - "W/O" (walkover)
    - "RET" (retired)
    """
    if match.status == Match.Status.WALKOVER:
        return "W/O"
    
    if match.status == Match.Status.RETIRED:
        outcome = match.special_outcome
        return f"{outcome.score_at_stop} RET"
    
    if match.status == Match.Status.DEFAULT:
        return "DEF"
    
    # Обычный счет
    sets = match.sets.all().order_by('index')
    return ", ".join(str(s) for s in sets)
```

### React компонент

```tsx
const MatchScore: React.FC<{ match: Match }> = ({ match }) => {
  const getScoreDisplay = () => {
    if (match.status === 'walkover') return 'W/O';
    if (match.status === 'retired') return `${match.score_at_stop} RET`;
    if (match.status === 'default') return 'DEF';
    
    return match.sets.map(s => s.display).join(', ');
  };
  
  return (
    <div className={`match-score status-${match.status}`}>
      {getScoreDisplay()}
    </div>
  );
};
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
