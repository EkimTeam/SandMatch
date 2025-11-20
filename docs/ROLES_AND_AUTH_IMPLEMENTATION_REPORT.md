# ROLES_AND_AUTH_IMPLEMENTATION_REPORT

Краткий отчёт по реализации плана ролей и доступа (`ROLES_AND_AUTH_PLAN.md`).

## Backend

### Accounts / роли и профили

**Файлы:**
- `apps/accounts/models.py` — модель `UserProfile` с полями `user`, `role` (`ADMIN|ORGANIZER|REFEREE|REGISTERED`), `player`, `telegram_id`, `telegram_username`.
- `apps/accounts/signals.py` — автосоздание `UserProfile` при создании `User`.
- `apps/accounts/permissions.py`:
  - enum `Role`;
  - функции и классы: `_get_user_role`, `IsAdminOrReadOnly`, `IsAdmin`, `IsAuthenticatedAndRoleIn`, `IsTournamentCreatorOrAdmin`, `IsRefereeForTournament`.
- `apps/accounts/api_views.py`:
  - `register` (`POST /api/auth/register/`) — создание `User` + `UserProfile` (роль `REGISTERED`), валидация пароля;
  - `me` (`GET /api/auth/me/`) — информация о пользователе + поле `role`, `player_id`, `telegram_*`;
  - `password_reset` (`POST /api/auth/password/reset/`) — принимает `email`, ищет пользователя, генерирует `uid` и `token` через `default_token_generator`, в dev возвращает их в ответе;
  - `password_reset_confirm` (`POST /api/auth/password/reset/confirm/`) — принимает `{ uid, token, new_password }`, проверяет токен и валидирует/меняет пароль.
- `apps/accounts/api_urls.py` — маршруты `register/`, `me/`, `password/reset/`, `password/reset/confirm/` под `/api/auth/`.

JWT‑эндпоинты SimpleJWT подключены в `sandmatch/urls.py` (`/api/auth/token/`, `/api/auth/token/refresh/`).

### Турниры и права

**Файлы:**
- `apps/tournaments/models.py` — в `Tournament` добавлены/используются поля `created_by`, `referees`.
- `apps/tournaments/api_views.py`:
  - `TournamentViewSet.get_permissions()`:
    - `create` — `IsAuthenticatedAndRoleIn(Role.ADMIN, Role.ORGANIZER)`;
    - update/partial_update/`set_ruleset`/`set_participant`/`save_participants`/`create_knockout_bracket`/`seed_bracket`/`lock_participants`/`unlock_participants`/`complete` — `IsTournamentCreatorOrAdmin()`;
    - `destroy`/`remove` — `IsAdmin()`;
    - матчевые действия (start/save/cancel/reset) — только для создателя/админа и/или рефери (через `IsTournamentCreatorOrAdmin` и `IsRefereeForTournament`).
  - `tournament_list` (`GET /api/tournaments/overview/`) — отдаёт активные и завершённые турниры; для анонимов история турниров по сути пустая (фронт показывает подсказку гостю).
  - `referee_my_tournaments` (`GET /api/referee/my_tournaments/`) — только для ролей `REFEREE` и `ADMIN`, возвращает активные турниры, где текущий пользователь в `referees`.
- `apps/tournaments/api_urls.py` — маршруты `tournaments/overview/`, `referee/my_tournaments/` и спец‑действия турниров.

### Игроки и рейтинг

**Файлы:**
- `apps/players/api_rating.py` — публичные ручки только для общего рейтинга/сводной статистики, персональные данные игрока требуют аутентификации.
- `apps/tournaments/api_views.py` — `PlayerListView`, `PlayerSearchView`, `PlayerCreateView` настроены с нужными `permission_classes` (аноним не видит список/поиск игроков).

## Frontend

### Auth‑инфраструктура

**Файлы:**
- `frontend/src/services/auth.ts` — работа с JWT (localStorage, `obtainToken`, `refreshAccessToken`, `clearTokens`).
- `frontend/src/services/api.ts`:
  - axios‑клиент `/api` с подстановкой `Authorization: Bearer` и авто‑рефрешем токена;
  - `UserMe` + `authApi.register`, `authApi.me`, `authApi.requestPasswordReset`, `authApi.resetPasswordConfirm`;
  - `refereeApi.myTournaments` (`GET /api/referee/my_tournaments/`).
- `frontend/src/context/AuthContext.tsx` — глобальное состояние `user`, `role`, `refreshMe`, `logout`.
- `frontend/src/App.tsx`:
  - `RequireAuth` (проверка наличия токена);
  - публичные маршруты: `/login`, `/register`, `/reset-password`, `/reset-password/confirm`, `/`, `/tournaments`, `/rating`, `/stats`;
  - защищённые маршруты: `/tournaments/:id/...`, `/players*`, `/referee`.
- `frontend/src/components/Layout.tsx` — меню по ролям:
  - гость: Турниры/Рейтинг/Статистика + Войти/Регистрация;
  - авторизованный (кроме REFEREE): Турниры/Игроки/Рейтинг/Статистика + username [ROLE] + Выйти;
  - REFEREE: только пункт «Судейство» + username [REFEREE] + Выйти.

### Страницы аутентификации

- `LoginPage.tsx` — логин через `obtainToken` + `refreshMe`, ссылки на регистрацию и восстановление пароля.
- `RegisterPage.tsx` — регистрация + автоматический вход.
- `PasswordResetRequestPage.tsx` (`/reset-password`) — запрос сброса пароля по email, вывод dev‑`uid`/`token`.
- `PasswordResetConfirmPage.tsx` (`/reset-password/confirm`) — ввод нового пароля по `uid`/`token`, дружелюбные сообщения об успехе/ошибке и переход на `/login`.

### Турниры и роли

- `TournamentListPage.tsx` (`/`, `/tournaments`):
  - публичный список активных турниров;
  - история завершённых турниров — только для авторизованных; гостю показывается текст «Зарегистрируйтесь, чтобы видеть завершенные турниры»;
  - кнопка «Начать новый турнир» / модалка создания — только для ролей `ADMIN` и `ORGANIZER`;
  - для роли `REFEREE` страница показывает сообщение, что список турниров недоступен и надо использовать раздел «Судейство».
- `TournamentDetailPage.tsx` (круговая система):
  - вычисляются флаги: `canManageTournament` (ADMIN/ORGANIZER) и `canManageMatches` (ADMIN/ORGANIZER/REFEREE);
  - клики по ячейкам:
    - ячейка участника (type `participant`) доступна только при `canManageTournament`;
    - ячейка счёта (type `score`) доступна только при `canManageMatches`;
  - фиксация участников и модалка выбора участника — только для `canManageTournament`;
  - нижняя панель:
    - завершение/удаление турнира — только `canManageTournament`;
    - «Поделиться» скрыта для роли `REFEREE`.
- `KnockoutPage.tsx`:
  - флаги `canManageStructure` (ADMIN/ORGANIZER) и `canManageMatches` (дополнительно REFEREE);
  - структурные действия (создание/фиксация/seed, drag&drop, удаление участников) — только `canManageStructure`;
  - матчевые действия — только `canManageMatches`;
  - кнопка «Поделиться» не отображается для `role === 'REFEREE'`.
- `KingPage.tsx`:
  - флаг `canManageTournament` (ADMIN/ORGANIZER);
  - выбор режима подсчёта (G-/M+/NO) и регламента доступен только при `canManageTournament` и статусе `active`;
  - фиксация участников/завершение/удаление — только для организатора/админа.
- `RefereePage.tsx` (`/referee`):
  - доступ только для `REFEREE` (остальным показывает текст‑ограничение);
  - использует `refereeApi.myTournaments()` и показывает список активных турниров, где пользователь назначен рефери, с переходами в нужный вид (RR/KO/King).

### Рейтинг, статистика и игроки

- `RatingPage.tsx` (`/rating`):
  - публичная таблица лидеров (`ratingApi.leaderboard`);
  - при `user.role === 'REFEREE'` вместо таблицы — сообщение, что общий рейтинг недоступен, нужно использовать раздел «Судейство».
- `StatsPage.tsx` (`/stats`):
  - сводная статистика через `ratingApi.summaryStats`;
  - при `user.role === 'REFEREE'` — сообщение, что общая статистика недоступна для судьи.
- `PlayersPage.tsx` (`/players`):
  - только для авторизованных (маршрут под `RequireAuth`);
  - подгружает список игроков и их рейтинговые «брифы»;
  - при `user.role === 'REFEREE'` показывает сообщение, что страница игроков недоступна, и предлагает использовать «Судейство».

---

## Дополнения по турнирам (удаление и UI)

- В `TournamentSerializer` добавлено поле `can_delete`, вычисляемое через permission `IsTournamentCreatorOrAdminForDeletion`.
  - Создатель турнира может удалить **только свои** турниры и только пока статус не `completed`.
  - `ADMIN`/staff/superuser могут удалять любые турниры.
  - Прочие роли (включая других ORGANIZER) никогда не получают `can_delete = true`.
- Фронтенд использует `can_delete` для показа и работы кнопки «Удалить турнир» на страницах:
  - круговой системы (`TournamentDetailPage.tsx`),
  - олимпийки (`KnockoutPage.tsx`),
  - King (`KingPage.tsx`).
- Для завершённых турниров King:
  - радиокнопки режима подсчёта и выбор регламента переводятся в read‑only (disabled),
  - таблицы и расписание по группам продолжают отображаться, но без возможности редактирования.
- Шапки страниц трёх систем (RR/KO/King) унифицированы до формата из King:
  1. Первая строка — только имя турнира.
  2. Вторая строка — `дата • система • формат • Организатор: ФИО`.
  3. Третья строка — `Статус: ... • Участников: N`.

Этот файл можно расширять при дальнейших изменениях (например, когда будет реализован "Мой профиль" и привязка к Player).
