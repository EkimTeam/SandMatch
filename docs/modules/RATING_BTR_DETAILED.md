# Рейтинг BTR (Beach Tennis Russia) - Детальная документация

## Описание

BTR (BeachTennisRussia) - официальная рейтинговая система пляжного тенниса в России. Система импортирует данные из внешних источников BTR и синхронизирует их с локальными игроками.

**Ключевые особенности:**
- Импорт данных из Excel файлов BTR
- Хранение исторических снимков рейтинга
- Поддержка 6 категорий (мужчины/женщины, парный/смешанный, юниоры)
- Автоматическая синхронизация с Player
- API для получения рейтингов и карточек игроков

---

## Архитектура

### Backend компоненты

**Модели** (`apps/btr/models.py`):
- `BtrPlayer` - игрок в системе BTR
- `BtrSourceFile` - исходные файлы рейтинга
- `BtrRatingSnapshot` - снимки рейтинга по датам

**Сервисы** (`apps/btr/services/`):
- `downloader.py` - скачивание файлов BTR
- `parser.py` - парсинг Excel файлов

**Management команды** (`apps/btr/management/commands/`):
- `fetch_btr_ratings.py` - загрузка рейтингов
- `import_btr_files.py` - импорт из файлов
- `clear_btr_data.py` - очистка данных
- `check_btr_files.py` - проверка файлов

**API** (`apps/btr/api_rating.py`):
- Endpoints для получения рейтингов

### Frontend компоненты

**Страницы:**
- `frontend/src/pages/BTRPlayerCardPage.tsx` - карточка игрока BTR

---

## Модели данных

### BtrPlayer

```python
class BtrPlayer(models.Model):
    external_id = models.IntegerField(unique=True)  # ID в системе BTR
    rni = models.IntegerField(unique=True)          # РНИ (номер в BTR)
    last_name = models.CharField(max_length=100)
    first_name = models.CharField(max_length=100, blank=True)
    middle_name = models.CharField(max_length=100, blank=True)
    gender = models.CharField(choices=[('male', 'Мужчина'), ('female', 'Женщина')])
    birth_date = models.DateField(blank=True, null=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=64, blank=True)
```

**Связь с Player:**
```python
# В модели Player
btr_player = models.OneToOneField(BtrPlayer, null=True, related_name='local_player')
```

### BtrSourceFile

```python
class BtrSourceFile(models.Model):
    url = models.URLField()                    # URL источника
    filename = models.CharField(max_length=255)
    downloaded_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(blank=True, null=True)
    file_hash = models.CharField(max_length=128)  # MD5/SHA256
```

**Назначение:** Отслеживание обработанных файлов, предотвращение дублирования.

### BtrRatingSnapshot

```python
class BtrRatingSnapshot(models.Model):
    class Category(models.TextChoices):
        MEN_DOUBLE = "men_double", "Взрослые, парный, мужчины"
        MEN_MIXED = "men_mixed", "Взрослые, смешанный, мужчины"
        WOMEN_DOUBLE = "women_double", "Взрослые, парный, женщины"
        WOMEN_MIXED = "women_mixed", "Взрослые, смешанный, женщины"
        JUNIOR_MALE = "junior_male", "До 19, Юноши"
        JUNIOR_FEMALE = "junior_female", "До 19, Девушки"
    
    player = models.ForeignKey(BtrPlayer, related_name="snapshots")
    category = models.CharField(max_length=32, choices=Category.choices)
    rating_date = models.DateField()           # Дата рейтинга
    rating_value = models.IntegerField()       # Значение рейтинга
    rank = models.IntegerField(null=True)      # Позиция в рейтинге
    tournaments_total = models.IntegerField(default=0)
    tournaments_52_weeks = models.IntegerField(default=0)
    tournaments_counted = models.IntegerField(default=0)
```

**Индексы:**
```python
indexes = [
    models.Index(fields=["player", "category", "rating_date"])
]
```

---

## Импорт данных

### Процесс импорта

**1. Скачивание файлов** (`downloader.py`):
```python
def download_btr_file(url: str) -> bytes:
    """Скачать Excel файл BTR"""
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return response.content
```

**2. Парсинг Excel** (`parser.py`):
```python
def parse_btr_excel(file_content: bytes) -> List[Dict]:
    """
    Парсинг Excel файла BTR.
    
    Ожидаемые колонки:
    - РНИ (номер игрока)
    - Фамилия
    - Имя
    - Рейтинг
    - Позиция
    - Турниров всего
    - Турниров за 52 недели
    - Учтённых турниров
    """
    wb = openpyxl.load_workbook(BytesIO(file_content))
    ws = wb.active
    
    results = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0]:  # Пропустить пустые строки
            continue
        
        results.append({
            'rni': int(row[0]),
            'last_name': row[1],
            'first_name': row[2],
            'rating': int(row[3]),
            'rank': int(row[4]) if row[4] else None,
            'tournaments_total': int(row[5]) if row[5] else 0,
            'tournaments_52_weeks': int(row[6]) if row[6] else 0,
            'tournaments_counted': int(row[7]) if row[7] else 0,
        })
    
    return results
```

**3. Сохранение в БД** (`fetch_btr_ratings.py`):
```python
@transaction.atomic
def import_btr_data(file_url: str, category: str, rating_date: date):
    # 1. Скачать файл
    content = download_btr_file(file_url)
    file_hash = hashlib.md5(content).hexdigest()
    
    # 2. Проверить дубликаты
    if BtrSourceFile.objects.filter(file_hash=file_hash).exists():
        return  # Уже обработан
    
    # 3. Парсинг
    data = parse_btr_excel(content)
    
    # 4. Создать/обновить BtrPlayer
    for row in data:
        player, created = BtrPlayer.objects.update_or_create(
            rni=row['rni'],
            defaults={
                'last_name': row['last_name'],
                'first_name': row['first_name'],
            }
        )
        
        # 5. Создать снимок рейтинга
        BtrRatingSnapshot.objects.create(
            player=player,
            category=category,
            rating_date=rating_date,
            rating_value=row['rating'],
            rank=row['rank'],
            tournaments_total=row['tournaments_total'],
            tournaments_52_weeks=row['tournaments_52_weeks'],
            tournaments_counted=row['tournaments_counted'],
        )
    
    # 6. Сохранить информацию о файле
    BtrSourceFile.objects.create(
        url=file_url,
        filename=file_url.split('/')[-1],
        file_hash=file_hash,
        applied_at=timezone.now()
    )
```

---

## Синхронизация с Player

### Автоматическое связывание

```python
def link_btr_to_player(btr_player: BtrPlayer) -> Optional[Player]:
    """
    Связать BtrPlayer с локальным Player.
    
    Алгоритм:
    1. Поиск по точному совпадению ФИО
    2. Поиск по частичному совпадению
    3. Ручное связывание через админку
    """
    # Точное совпадение
    player = Player.objects.filter(
        last_name__iexact=btr_player.last_name,
        first_name__iexact=btr_player.first_name
    ).first()
    
    if player and not player.btr_player:
        player.btr_player = btr_player
        player.save()
        return player
    
    return None
```

### Обновление рейтинга Player

```python
def update_player_btr_rating(player: Player):
    """Обновить BTR рейтинг игрока из последнего снимка"""
    if not player.btr_player:
        return
    
    # Получить последний снимок для основной категории
    category = 'men_double' if player.gender == 'male' else 'women_double'
    
    latest_snapshot = BtrRatingSnapshot.objects.filter(
        player=player.btr_player,
        category=category
    ).order_by('-rating_date').first()
    
    if latest_snapshot:
        player.btr_rating = latest_snapshot.rating_value
        player.save(update_fields=['btr_rating'])
```

---

## API Endpoints

### GET /api/btr/players/{rni}/

Получить информацию об игроке BTR по РНИ.

**Response:**
```json
{
  "rni": 12345,
  "external_id": 67890,
  "last_name": "Иванов",
  "first_name": "Иван",
  "gender": "male",
  "city": "Москва",
  "current_ratings": {
    "men_double": {
      "rating": 1500,
      "rank": 42,
      "date": "2024-07-01"
    },
    "men_mixed": {
      "rating": 1450,
      "rank": 55,
      "date": "2024-07-01"
    }
  }
}
```

### GET /api/btr/players/{rni}/history/

Получить историю рейтинга игрока.

**Query params:**
- `category` - категория рейтинга
- `from_date` - начальная дата
- `to_date` - конечная дата

**Response:**
```json
{
  "rni": 12345,
  "category": "men_double",
  "history": [
    {
      "date": "2024-07-01",
      "rating": 1500,
      "rank": 42
    },
    {
      "date": "2024-06-01",
      "rating": 1480,
      "rank": 45
    }
  ]
}
```

---

## Management команды

### fetch_btr_ratings

Загрузить рейтинги из BTR.

```bash
python manage.py fetch_btr_ratings \
  --url "https://btr.ru/ratings/men_double.xlsx" \
  --category men_double \
  --date 2024-07-01
```

### import_btr_files

Импортировать из локальных файлов.

```bash
python manage.py import_btr_files \
  --directory /path/to/files \
  --category men_double
```

### clear_btr_data

Очистить данные BTR.

```bash
python manage.py clear_btr_data --confirm
```

---

## Frontend

### Карточка игрока BTR

**Компонент:** `BTRPlayerCardPage.tsx`

**Отображаемые данные:**
- Основная информация (ФИО, город, дата рождения)
- Текущие рейтинги по всем категориям
- График истории рейтинга
- Статистика турниров
- Ссылка на профиль в BTR

**Пример:**
```tsx
<div className="btr-card">
  <h1>{player.last_name} {player.first_name}</h1>
  <div className="ratings">
    {Object.entries(player.current_ratings).map(([cat, data]) => (
      <div key={cat} className="rating-item">
        <span>{categoryNames[cat]}</span>
        <strong>{data.rating}</strong>
        <small>#{data.rank}</small>
      </div>
    ))}
  </div>
  <RatingChart history={player.history} />
</div>
```

---

## Маппинг BTR → BP

Для турниров используется конвертация BTR рейтинга в BP (Beach Play).

**Таблица соответствия** (см. `docs/BTR_TO_BP_RATING_MAPPING.md`):
```
BTR 1500+ → BP 5.0
BTR 1400-1499 → BP 4.5
BTR 1300-1399 → BP 4.0
BTR 1200-1299 → BP 3.5
...
```

**Функция конвертации:**
```python
def btr_to_bp(btr_rating: int) -> float:
    """Конвертировать BTR рейтинг в BP"""
    if btr_rating >= 1500:
        return 5.0
    elif btr_rating >= 1400:
        return 4.5
    elif btr_rating >= 1300:
        return 4.0
    # ... и т.д.
    else:
        return 1.0
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
