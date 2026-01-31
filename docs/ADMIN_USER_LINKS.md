# Инструмент связей User / Player / TelegramUser

Путь во фронтенде: `/admin/user-links`
API: `GET/POST /auth/users/{user_id}/links/`
Бэкенд: `apps/accounts/api_views.py::admin_user_links`

Инструмент позволяет администратору править связи между:
- **User** – Django-пользователь
- **Player** – игрок BeachPlay
- **TelegramUser** – телеграм-профиль, через который бот шлёт уведомления

---

## 1. Структура основных моделей

### 1.1. TelegramUser (`apps.telegram_bot.models.TelegramUser`)

Ключевые поля:
- `telegram_id: BigIntegerField(unique=True, null=True)` – ID пользователя в Telegram. **Уникален**.
- `username: CharField(null=True, blank=True)` – @username
- `first_name`, `last_name`
- `user: OneToOneField(User, null=True)` – связанный аккаунт сайта
- `player: OneToOneField(players.Player, null=True)` – связанный игрок
- `notifications_enabled`, `notify_*`, `language_code`, `is_blocked`

Ограничения:
- Один `TelegramUser` ↔ один `User` (OneToOne)
- Один `TelegramUser` ↔ один `Player` (OneToOne)
- Один `telegram_id` может принадлежать только одной записи `TelegramUser`.

### 1.2. User / UserProfile / Player

- `User` — стандартная Django-модель.
- `UserProfile` — содержит `role` и ссылку на `player`.
- `Player` — сущность игрока (ФИО, дата рождения и т.п.).

Инструмент `/admin/user-links` агрегирует:
- `user` (часть полей)
- `profile` (role, player_id)
- `player` (данные игрока)
- `telegram_user` (данные TelegramUser, если есть `user.telegram_profile`).

---

## 2. Что можно менять через `/admin/user-links`

По коду `admin_user_links`:

- **User**:
  - можно менять `username`, `email`, `first_name`, `last_name`, `is_active`.

- **Profile**:
  - при наличии блока `profile` можно менять `role` и `player_id` (с проверкой, что игрок существует).

- **Player**:
  - редактируются поля уже существующего игрока (id должен существовать),
  - новые игроки через этот API **не создаются**.

- **TelegramUser**:
  - редактируется только **существующий** `telegram_profile` (новый не создаётся),
  - можно менять:
    - `telegram_id`, `username`, `first_name`, `last_name`, `language_code`,
    - `is_blocked`, `notifications_enabled`, `notify_*`,
    - `player_id` (с проверкой OneToOne: один Player ↔ один TelegramUser).

Важно:
- При смене `player_id` проверяется, не занят ли этот игрок другим `TelegramUser`.
- При сохранении `telegram_id` соблюдается уникальность — если такой ID уже есть в другой записи, сохранение упадёт.

---

## 3. Типовой сценарий: ручная привязка Telegram к пользователю

**Задача:** у конкретного пользователя/игрока вручную проставить `telegram_id`, чтобы бот мог с ним работать.

### 3.1. Предпосылки

- У пользователя уже есть `User` и (желательно) `Player`.
- Есть запись `TelegramUser` в базе **или** ты знаешь `telegram_id` и хочешь использовать его для существующего `telegram_profile`.

### 3.2. Алгоритм через `/admin/user-links`

1. Перейти на `/admin/user-links` под админом.
2. В левом списке найти нужного пользователя и нажать **«Открыть»**.
3. В правой панели:
   - Проверить блок **User** (ФИО/логин/почта).
   - В блоке **Player** убедиться, что отображается нужный игрок.
   - В блоке **Telegram User**:
     - Если блок **есть** (значит у `User` уже есть `telegram_profile`):
       - В поле **Telegram ID** указать нужное значение (`telegram_bot_telegramuser.telegram_id` или ID из логов/бота).
       - При желании заполнить `Username`, `Имя`, `Фамилия`.
       - Убедиться, что:
         - `Player ID` совпадает с ID нужного игрока;
         - `Язык` (`language_code`) = `ru` (или нужный);
         - флажок **«Заблокирован»** снят;
         - флажок **«Уведомления»** включён.
     - Если блока **нет** (у пользователя ещё нет `telegram_profile`):
       - Создать или привязать `TelegramUser` через стандартную Django-админку (`/sm-admin`):
         - либо создать новую запись `TelegramUser` и выставить поле `user = этот User`;
         - либо найти существующую запись `TelegramUser` с нужным `telegram_id` и выставить у неё `user = этот User`.
       - После этого обновить `/admin/user-links` — блок **Telegram User** появится, и его можно редактировать (включая `telegram_id`).
4. Нажать **«Сохранить изменения»**.

После этого:
- `TelegramUser.user` указывает на выбранного пользователя.
- `TelegramUser.telegram_id` содержит ID телеграм-аккаунта (чат-ид).
- `TelegramUser.player` ссылается на нужного игрока.
- Бот может:
  - находить пользователя по `telegram_id`,
  - понимать, какой это `User` и `Player`,
  - отправлять ему уведомления.

---

## 4. Важные замечания по безопасности данных

- **Не меняй** через этот инструмент пароль, права суперпользователя и т.п. — они здесь не обрабатываются.
- Перед присвоением `telegram_id` убедись, что этот ID **не используется** другой записью `TelegramUser`:
  - если используется — сначала обнули/исправь старую запись (в админке `TelegramUser`),
  - только потом выставляй этот ID в нужном `telegram_profile`.
- При сомнении лучше сначала сделать резервную копию записей `TelegramUser` / `Player` / `UserProfile`.
