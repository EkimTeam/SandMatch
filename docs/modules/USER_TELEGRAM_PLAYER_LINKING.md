# Связь пользователя, Telegram-аккаунта, игрока и BTR-игрока

**Версия:** 1.0  
**Дата:** 5 января 2026

---

## 1. Сущности и таблицы

- **User** — Django-пользователь (таблица `auth_user`).
- **Player** — профиль игрока SandMatch (таблица `players_player`).
- **TelegramUser** — связка Telegram ↔ User ↔ Player (таблица `telegram_bot_telegramuser`).
- **BtrPlayer** — внешний профиль игрока в системе BTR (таблица `btr_btrplayer`).

### TelegramUser

Модель `apps.telegram_bot.models.TelegramUser`:

- `telegram_id: BigIntegerField, unique, null=True` — Telegram ID пользователя.
- `username: CharField` — @username в Telegram.
- `first_name, last_name` — имя/фамилия из Telegram.
- `user: OneToOneField(User)` — связанный Django-пользователь.
- `player: OneToOneField(Player)` — связанный профиль игрока.
- настройки уведомлений и метаданные (язык, флаги блокировки и т.д.).

Ограничения:

- у **каждого Telegram ID** максимум один `TelegramUser`;
- у **каждого User** максимум один `TelegramUser`;
- у **каждого Player** максимум один `TelegramUser`.

---

## 2. Связывание User ↔ Player (на сайте)

Страница профиля: `/profile`.

Поток:

1. Пользователь заходит в личный кабинет.
2. В блоке «Связь с профилем игрока» нажимает:
   - «Да, это я» для одного из автокандидатов, или
   - «Найти и связать профиль игрока» и выбирает игрока из поиска.
3. Фронтенд вызывает endpoint:

   - `POST /api/auth/profile/link-player/`
   - Body: `{ "player_id": number }`

4. Backend (`apps.accounts.api_views.link_player`):
   - проверяет, что выбранный `Player` не связан с другим пользователем;
   - ищет `TelegramUser` по `user`:
     - если есть — обновляет поле `player`;
     - если нет — создаёт запись `TelegramUser(user=<user>, player=<player>, telegram_id=NULL)`;
   - синхронизирует ФИО между `User` и `Player`.

Результат:

- Django-пользователь **логически привязан** к `Player` через `TelegramUser.user` и `TelegramUser.player`.
- Эту связку потом использует и Mini App, и веб-интерфейс регистрации.

Отвязка выполняется через:

- `POST /api/auth/profile/unlink-player/`

которая обнуляет `telegram_user.player` для текущего пользователя.

---

## 3. Связывание Telegram ↔ User (через бота)

### 3.1. Шаг 1 — /start

Пользователь в Telegram пишет боту `/start`.

Обработчик: `apps.telegram_bot.bot.handlers.start.cmd_start`.

- Вызывает `get_or_create_telegram_user(telegram_id, username, ...)`:
  - `TelegramUser.objects.get_or_create(telegram_id=telegram_id, defaults={...})`.
- Если запись не найдена — создаётся новая `TelegramUser` с заполненным `telegram_id`, но ещё **без `user` и `player`**.

### 3.2. Шаг 2 — генерация кода на сайте

В профиле сайта пользователь нажимает «Связать с Telegram».

- Вызов: `POST /api/telegram/generate-code/`.
- Создаётся `LinkCode(user=<current_user>, code=..., expires_at=...)`.
- Пользователь видит код и отправляет его боту в виде `/link ABC123`.

### 3.3. Шаг 3 — команда /link в боте

Обработчик: `apps.telegram_bot.bot.handlers.link.cmd_link`.

1. Получает `telegram_user` по `telegram_id`:

   ```python
   telegram_user = TelegramUser.objects.get(telegram_id=message.from_user.id)
   ```

2. Вызывает `validate_and_use_code(code, telegram_user)`.

Внутри `validate_and_use_code`:

- Находит `LinkCode` по коду и проверяет срок действия.
- Проверяет, не привязан ли уже этот Telegram к другому пользователю.
- **Новая логика объединения:**
  - ищет существующий `TelegramUser` для `link_code.user`:

    ```python
    existing_for_user = TelegramUser.objects.filter(user=link_code.user).exclude(pk=telegram_user.pk).first()
    ```

  - если он найден и у него `telegram_id is None`, то:
    - переносит `telegram_id`, `username`, имя/фамилию и язык из `telegram_user` в `existing_for_user`;
    - удаляет временную запись `telegram_user`;
    - продолжает работу уже с `existing_for_user`;
  - если найден и у него уже есть другой `telegram_id`, возвращает ошибку:
    - «Этот аккаунт уже связан с другим Telegram».

- После возможного объединения:
  - устанавливает `telegram_user.user = link_code.user`;
  - при отсутствии `telegram_user.player` пытается автоматически найти `Player` по email/ФИО пользователя;
  - сохраняет `telegram_user`;
  - помечает `LinkCode` как использованный.

Результат:

- Для каждого пользователя и Telegram ID в итоге остаётся **ровно одна** запись `TelegramUser`.
- Если сначала была создана связь User ↔ Player на сайте (через `link-player`), а потом пользователь связал Telegram, то `telegram_id` аккуратно дописывается в существующую запись.

---

## 4. Использование связки в регистрации турниров

Единым источником истины для регистрации является `TournamentRegistration` / `TournamentEntry` и сервис `RegistrationService`.

Для определения текущего игрока во всех интерфейсах используется `TelegramUser`:

- **Mini App** (Telegram WebApp):
  - аутентификация по `X-Telegram-Init-Data` → `TelegramUser` → `player_id`.
- **Веб-сайт**:
  - по `request.user` находится `TelegramUser`:

    ```python
    from apps.telegram_bot.models import TelegramUser

    telegram_user = TelegramUser.objects.filter(user=request.user).select_related("player").first()
    player = telegram_user.player if telegram_user else None
    ```

  - если `player` не найден — пользователю предлагается связать профиль с игроком на `/profile`.

Дальше все сценарии регистрации (сайт, бот, Mini App) используют общий сервис:

- `RegistrationService.register_single(tournament, player)`
- `RegistrationService.register_looking_for_partner(tournament, player)`
- `RegistrationService.register_with_partner(tournament, player, partner)`
- `RegistrationService.send_pair_invitation(...)` и т.д.

---

## 5. Связь Player ↔ BtrPlayer

В модели `Player`:

```python
btr_player = models.OneToOneField(
    "btr.BtrPlayer",
    verbose_name="Профиль BTR",
    on_delete=models.SET_NULL,
    blank=True,
    null=True,
    related_name="linked_player",
)
```

- Один `Player` может быть связан максимум с одним `BtrPlayer`.
- Один `BtrPlayer` может быть связан максимум с одним `Player` (через `related_name='linked_player'`).
- Эта связь используется для:
  - получения исходного рейтинга BTR;
  - расчёта стартового BP-рейтинга (`calculate_initial_bp_rating_from_btr`);
  - отображения BTR-профиля в интерфейсе (если он есть).

---

## 6. Итоговая картина связей

- Пользователь сайта (`User`) связывается с:
  - **TelegramUser.user** — через /start + /link;
  - **TelegramUser.player** — через:
    - /profile → link-player (ручной выбор игрока),
    - или автоматически при /link (по email/ФИО, если найден подходящий Player).
- Игрок (`Player`) опционально связан с:
  - **BtrPlayer** — через поле `btr_player`.
- Все сценарии регистрации и уведомлений опираются на связку:

```text
User ↔ TelegramUser ↔ Player ↔ (опционально) BtrPlayer
```

Эта архитектура обеспечивает:

- единый профиль игрока для сайта, бота и Mini App;
- отсутствие дублирования `TelegramUser` для одного пользователя;
- возможность последовательно подключать BTR, Telegram и веб-интерфейс к одному и тому же игроку.
