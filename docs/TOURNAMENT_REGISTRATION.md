# Регистрация на турниры: спецификация и TODO-план

Этот документ описывает текущую архитектуру и состояние регистрации на турниры в SandMatch, а также содержит TODO-план по доработкам.

## Содержание

1. [Базовые сущности и термины](#1-базовые-сущности-и-термины)
2. [RegistrationService: единый сервис регистрации](#2-registrationservice-единый-сервис-регистрации)
3. [Синхронизация через сигналы](#3-синхронизация-через-сигналы)
4. [Разрез 1: индивидуальный vs парный турнир](#4-разрез-1-индивидуальный-vs-парный-турнир)
5. [Разрез 2: веб, мини-апп, телеграм-бот](#5-разрез-2-веб-мини-апп-телеграм-бот)
6. [TODO-план по регистрации](#6-todo-план-по-регистрации)

---

## 1. Базовые сущности и термины

### 1.1. Основной состав, резерв, поиск пары

Для любой регистрации на турнир выделяются три ключевых слоя:

- **Основной состав (main_list)**  
  Пары/игроки, которые попадают в турнир в рамках лимита `planned_participants`.

- **Резервный состав (reserve_list)**  
  Пары/игроки сверх лимита `planned_participants`. При освобождении мест могут переходить в основной состав.

- **Режим "ищет пару" (looking_for_partner)**  
  Актуально для парных турниров. Игрок зарегистрирован, но без окончательно сформированной команды:
  - может быть найден и добавлен в пару через веб/мини-апп/бот;
  - может получать и отправлять приглашения в пару.

### 1.2. Модель TournamentRegistration

**Файл:** `apps/tournaments/registration_models.py`

Модель `TournamentRegistration` хранит регистрацию **одного игрока** на **один турнир**:

- `tournament: FK(Tournament, related_name="registrations")`
- `player: FK(Player, related_name="tournament_registrations")`
- `partner: FK(Player, null=True)` — напарник (если уже есть пара)
- `team: FK(Team, null=True)` — команда из `teams.Team`
- `status: CharField` с перечислением:
  - `looking_for_partner` — игрок ищет пару
  - `invited` — игрок получил приглашение в пару (пока не принял)
  - `main_list` — основная сетка
  - `reserve_list` — резервный список
- `registration_order: int` — порядковый номер регистрации, определяет попадание в основной/резервный список
- `registered_at: DateTime` — дата регистрации
- `updated_at: DateTime` — дата последнего обновления

**Инварианты** (проверяются в `clean`):
- игрок не может быть своим напарником
- при наличии напарника (`partner`) должна быть команда (`team`)
- для статусов `main_list` / `reserve_list` команда обязательна

**Constraint:** уникальность `tournament + player` (один игрок = одна регистрация на турнир)

### 1.3. Модель TournamentEntry и связка с регистрацией

**Файл:** `apps/tournaments/models.py`

`TournamentEntry` описывает конкретную команду (team) как участника турнира.

**Связка с регистрацией:**
- Для статусов `MAIN_LIST` и `RESERVE_LIST` регистраций должна существовать соответствующая запись в `TournamentEntry`
- Для статусов `LOOKING_FOR_PARTNER` и `INVITED` участник **не должен** быть в `TournamentEntry`
- Синхронизация двусторонняя через сигналы (см. раздел 3)

## 2. RegistrationService: единый сервис регистрации

**Файл:** `apps/tournaments/services/registration_service.py`

`RegistrationService` инкапсулирует бизнес-логику регистрации.

### 2.1. Работа с командами

- `_get_or_create_team(player1, player2)` — находит или создаёт команду из двух игроков (учитывает обе перестановки A+B и B+A)

### 2.2. Пересчёт основной/резервной очереди

- `_recalculate_registration_statuses(tournament)`:
  - берёт все регистрации турнира со статусами `MAIN_LIST` и `RESERVE_LIST`
  - сортирует по `registration_order` и `registered_at`
  - в зависимости от `tournament.planned_participants` выставляет статус `MAIN_LIST` или `RESERVE_LIST`
  - синхронизирует `TournamentEntry` (через `_sync_to_tournament_entry`)
  - отправляет телеграм-уведомления об изменении статуса

### 2.3. Синхронизация с TournamentEntry

- `_sync_to_tournament_entry(registration)`:
  - для `MAIN_LIST`/`RESERVE_LIST` создаёт/обновляет `TournamentEntry` (если есть команда)
  - для прочих статусов удаляет `TournamentEntry`

### 2.4. Основные операции регистрации

**Одиночная регистрация:**

- `register_single(tournament, player)`:
  - создаёт/ищет команду из одного игрока
  - определяет `MAIN_LIST` или `RESERVE_LIST` по текущему числу `MAIN_LIST` и `planned_participants`
  - создаёт `TournamentRegistration` и синхронизирует в `TournamentEntry`

**Регистрация для парных турниров:**

- `register_looking_for_partner(tournament, player)`:
  - создаёт `TournamentRegistration` со статусом `LOOKING_FOR_PARTNER`
  - не создаёт `TournamentEntry`

- `register_with_partner(tournament, player, partner, notify_partner=True)`:
  - проверка, что ни игрок, ни партнёр не зарегистрированы на турнир
  - через `_get_or_create_team` получает команду
  - создаёт две синхронные регистрации (для обоих игроков) с общим `registration_order`
  - определяет `MAIN_LIST`/`RESERVE_LIST` по лимиту
  - синхронизирует в `TournamentEntry`
  - опционально рассылает уведомления

**Приглашения и управление парой:**

- `send_pair_invitation(tournament, sender, receiver, message)`:
  - проверяет, что `sender` находится в статусе "ищет пару"
  - проверяет, что `receiver` не находится уже в паре на этот турнир
  - создаёт `PairInvitation` и отправляет телеграм-уведомление

- `leave_pair(registration)` — разрыв текущей пары (оба игрока в "ищу пару")
- `cancel_registration(registration)` — полная отмена регистрации на турнир

## 3. Синхронизация через сигналы

**Файл:** `apps/tournaments/signals.py`

Синхронизация между `TournamentRegistration` и `TournamentEntry` реализована через Django сигналы и является **двусторонней**.

### 3.1. TournamentEntry → TournamentRegistration

- `post_save(TournamentEntry) → sync_tournament_entry_created`:
  - при создании/обновлении `TournamentEntry` вызывает `RegistrationService.sync_tournament_entry_to_registration(instance)`
  - создаёт/актуализирует регистрации для команд, которые появились через другие механизмы

- `post_delete(TournamentEntry) → sync_tournament_entry_deleted`:
  - при удалении `TournamentEntry` удаляет связанные `TournamentRegistration` для этой команды

### 3.2. Изменение лимита участников турнира

- `pre_save(Tournament) → track_planned_participants_change`:
  - запоминает старое значение `planned_participants`

- `post_save(Tournament) → recalculate_on_planned_participants_change`:
  - если лимит изменился, запускает `_recalculate_registration_statuses`

### 3.3. TournamentRegistration → TournamentEntry

- `pre_save(TournamentRegistration) → track_registration_status_change`:
  - отслеживает старый статус и команду

- `post_save(TournamentRegistration) → sync_registration_to_entry`:
  - синхронизирует `TournamentRegistration` в `TournamentEntry` через `_sync_to_tournament_entry`
  - при необходимости триггерит пересчёт очереди (`_recalculate_registration_statuses`) через `transaction.on_commit`
  - использует флаг `_skip_recalculation` для избежания рекурсии

- `post_delete(TournamentRegistration) → recalculate_on_registration_deleted`:
  - удаляет `TournamentEntry` для команды
  - пересчитывает очередь через `transaction.on_commit`

**Важно:** все пересчёты очереди выполняются через `transaction.on_commit` для безопасности и избежания проблем с вложенными транзакциями.

## 4. Разрез 1: индивидуальный vs парный турнир

### 4.1. Индивидуальные турниры (SINGLES)

- Регистрация идёт через `register_single(tournament, player)`
- Создаётся команда из одного игрока (`team.player_2 = null`)
- Основные сценарии:
  - регистрация игрока (веб/мини-апп/бот)
  - попадание в основной или резервный список по лимиту `planned_participants`
  - отмена регистрации
- Пара/поиск пары не используется

### 4.2. Парные турниры (DOUBLES)

Поддерживаются два основных сценария:

**1. Регистрация готовой парой:**
- игрок-инициатор указывает напарника
- создаётся команда из двух игроков и две синхронные записи регистрации
- пара попадает в основной или резервный список

**2. Регистрация через поиск пары:**
- игрок ставит себя в статус `LOOKING_FOR_PARTNER`
- другой игрок может:
  - найти его через поиск (веб/мини-апп)
  - отправить приглашение
- при формировании пары статусы и `TournamentEntry` синхронизируются автоматически

## 5. Разрез 2: веб, мини-апп, телеграм-бот

### 5.1. Веб-сайт

**Backend:** `apps/tournaments/api_views.py` (TournamentViewSet)

- Проверки доступа через `_ensure_can_register`, `_get_current_player`.
- `registration_state` / `registration_state_public` отдают три списка: `main_list`, `reserve_list`, `looking_for_partner`.
- Количество участников считается по `TournamentEntry` (команды), а не по числу `TournamentRegistration`.
- Все решения о попадании в основной/резервный список принимаются по количеству **команд**, а не строк регистрации.
- `cancel_registration` для пар:
  - удаляет `TournamentEntry`;
  - удаляет регистрацию инициатора;
  - явно регистрирует напарника в статусе `LOOKING_FOR_PARTNER` через `register_looking_for_partner`.
- Поиск напарника:
  - `search_players` и `recent_partners` помечают `is_registered = true`, если игрок уже состоит в паре (как в поле `player`, так и в `partner`) в `MAIN_LIST/RESERVE_LIST`;
  - дополнительно отдают рейтинг `rating_bp` (текущий BP игрока).

**Frontend:**

- Страница `/registration` (`TournamentRegistrationPage.tsx`):
  - блоки «Основной состав», «Резервный список», «Поиск пары»;
  - в «Основном составе» сортировка по алфавиту по ФИО пары;
  - в «Резервном списке» порядок по `registration_order`/дате регистрации;
  - везде рядом с ФИО/парой показывается BP‑рейтинг (для пары — средний);
  - подписи «Основной состав»/«Резервный список» под строками убраны (остались только заголовки блоков).
- Модалка выбора напарника (`PartnerSearchModalWeb.tsx`):
  - блок рекомендаций «Рекомендации по вашей истории» + поиск;
  - для каждого игрока показываются ФИО и BP‑рейтинг;
  - игроки, уже состоящие в парах (через сайт или добавленные организатором), помечаются `is_registered = true` и недоступны для выбора.

### 5.2. Telegram Mini App

**Файл:** `apps/telegram_bot/api_views.py`

#### Общие эндпоинты

- `GET /api/mini-app/tournaments/` — список турниров
- `GET /api/mini-app/tournaments/{id}/` — детальный просмотр
- `GET /api/mini-app/tournaments/my_tournaments/` — мои турниры

#### Старый эндпоинт (проблема)

- `POST /api/mini-app/tournaments/{id}/register/` — создаёт `TournamentEntry` напрямую, **минуя** `TournamentRegistration`

**Проблема:** сосуществуют два разных флоу регистрации (старый и новый).

#### Новые эндпоинты регистрации

- `GET /api/mini-app/tournaments/{id}/my-registration/` — моя регистрация
- `GET /api/mini-app/tournaments/{id}/participants/` — списки участников
- `POST /api/mini-app/tournaments/{id}/register-single/` — одиночная регистрация
- `POST /api/mini-app/tournaments/{id}/register-looking-for-partner/` — ищу пару
- `POST /api/mini-app/tournaments/{id}/register-with-partner/` — body: `{"partner_search": "ФИО"}`

**Статус:** backend частично переведён на новую систему. Требуется унификация.

### 5.3. Telegram-бот

- Профиль и привязка `TelegramUser ↔ Player` реализованы
- Уведомления о регистрации, изменении статусов и приглашениях — через `apps/telegram_bot/tasks.py`
- Флоу явной регистрации через бот-команды требует отдельной проверки

**Статус:** API для бота существует, требуется проверка интеграции.

## 6. TODO-план по регистрации

### 6.1. База (модели, сервис, сигналы)

- [x] Модель `TournamentRegistration` с полями и статусами
- [x] Модель `PairInvitation` для приглашений в пару
- [x] `RegistrationService` с методами регистрации и пересчёта очереди
- [x] Двусторонняя синхронизация через сигналы (`apps/tournaments/signals.py`)
- [x] Автоматический пересчёт при изменении `planned_participants`
- [x] Защита от рекурсии через флаг `_skip_recalculation`

### 6.2. Веб-регистрация (приоритет: ВЫСОКИЙ)

#### Backend (статус: ГОТОВО)

- [x] Проверки доступа (`_ensure_can_register`)
- [x] Эндпоинты состояния регистрации (`registration_state`, `registration_state_public`)
- [x] `POST /register_single/` для одиночных турниров
- [x] `POST /register_with_partner/` для парных турниров (учёт игроков из `LOOKING_FOR_PARTNER`)
- [x] `POST /register_looking_for_partner/` для режима "ищу пару"
- [x] `POST /send_invitation/` для приглашений
- [x] `POST /leave_pair/` для разрыва пары
- [x] `POST /cancel_registration/` для отмены регистрации с переводом напарника в `LOOKING_FOR_PARTNER`
- [x] `GET /search_players/` для поиска напарника (фильтрация игроков, уже состоящих в парах + рейтинг BP)
- [x] `GET /recent_partners/` для рекомендаций напарников

#### Frontend (статус: ГОТОВО)

**Для участников:**
- [x] Страница `/registration` показывает основной/резервный состав и список "Поиск пары" с корректным подсчётом команд и рейтингами.
- [x] Кнопки регистрации/отмены регистрации/поиска пары привязаны к соответствующим эндпоинтам.
- [x] Модалка поиска напарника с рекомендациями и рейтингами BP.
- [x] Отображение статусов регистрации (основной/резерв/ищу пару) и партнёра.
- [x] Индикация свободных мест и лимита участников.
- [x] Обработка ошибок и валидация форм.

**Для организаторов (интерфейс управления участниками):**
- [x] **Визуальное разделение списков** в `DraggableParticipantList`:
  - "Основной состав" (с указанием количества участников)
  - "Резервный список" (с указанием количества участников)
- [x] **Независимая сортировка списков:**
  - Основной состав: по ФИО или по рейтингу (выбор пользователя)
  - Резервный список: всегда по очереди регистрации (`registration_order`)
- [x] **Drag-and-Drop управление:**
  - Перетаскивание участников между основным и резервным списками
  - Добавление участников из "Ищу пару" в сформированные пары
  - Визуальная индикация "В сетке" для участников, уже добавленных в турнирную сетку
- [x] **Автопосев:**
  - Использует только участников из основного состава (MAIN_LIST)
  - Работает для всех систем: круговая, олимпийская, King
- [x] **Реализовано для всех систем турниров:**
  - `TournamentDetailPage.tsx` - круговая система
  - `KnockoutPage.tsx` - олимпийская система
  - `KingPage.tsx` - система King
- [x] **Модальное окно добавления участников** (`ParticipantPickerModal`):
  - Блокировка игроков, уже состоящих в парах (MAIN_LIST/RESERVE_LIST)
  - Возможность выбора игроков из статуса LOOKING_FOR_PARTNER
  - Формирование новых пар для добавления в турнир

### 6.3. Telegram Mini App (приоритет: СРЕДНИЙ)

#### Backend (статус: ЧАСТИЧНО ГОТОВО)

- [x] Новые эндпоинты регистрации (`my-registration`, `participants`, `register-single`, etc.)
- [x] Сериализаторы для мини-аппа
- [ ] **КРИТИЧНО: Унифицировать регистрацию в мини-аппе:**
  - [ ] решить судьбу старого `POST /api/mini-app/tournaments/{id}/register/`
  - [ ] либо переписать его через `RegistrationService`
  - [ ] либо заменить на новые эндпоинты и пометить как deprecated
  - [ ] убедиться, что весь флоу идёт через `TournamentRegistration`

#### Frontend (статус: ТРЕБУЕТ ПРОВЕРКИ)

- [ ] **Проверить UX мини-аппа:**
  - [ ] экран списка турниров с индикацией регистрации
  - [ ] экран турнира со статусом регистрации пользователя
  - [ ] списки основной/резервный/ищут пару
  - [ ] кнопки для трёх сценариев (solo / ищу пару / с партнёром)
  - [ ] модальные окна регистрации и поиска партнёра

- [ ] **Доработать компоненты мини-аппа:**
  - [ ] интеграция с новыми API эндпоинтами
  - [ ] обработка ошибок и состояний загрузки
  - [ ] уведомления об изменении статуса регистрации

### 6.4. Telegram-бот (приоритет: НИЗКИЙ)

- [x] Профиль и привязка `TelegramUser ↔ Player`
- [x] Уведомления через `apps/telegram_bot/tasks.py`
- [ ] **Проверить флоу бота:**
  - [ ] убедиться, что бот-команды регистрации работают через `RegistrationService`
  - [ ] проверить сценарии: регистрация solo, с партнёром, ищу партнёра
  - [ ] просмотр своей регистрации и отмена

### 6.5. Документация и тестирование

- [x] Создать документ `TOURNAMENT_REGISTRATION.md`
- [x] Описать модели, сервис, сигналы
- [x] Описать разрезы (индивидуальный/парный, веб/мини-апп/бот)
- [x] Создать TODO-план с чекбоксами
- [ ] **Добавить раздел "Типичные проблемы и решения":**
  - [ ] что делать, если игрок «не найден» (нет связки user ↔ Player)
  - [ ] как диагностировать рассинхронизацию между `TournamentRegistration` и `TournamentEntry`
  - [ ] как вручную поправить лимит `planned_participants` и запустить перерасчёт

- [ ] **Тестирование:**
  - [ ] unit-тесты для `RegistrationService`
  - [ ] интеграционные тесты для сигналов синхронизации
  - [ ] E2E тесты для веб-регистрации
  - [ ] E2E тесты для мини-аппа

### 6.6. Приоритизация работ

**Порядок выполнения (как указано в требованиях):**

1. **Сначала полностью завершить веб-регистрацию** (раздел 6.2)
2. Затем перенести функционал на мини-апп (раздел 6.3)
3. В последнюю очередь — бот (раздел 6.4)

**Текущий фокус:** проверка и доработка фронтенда веб-регистрации.
