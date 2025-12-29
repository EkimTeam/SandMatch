# Сводная таблица функционала системы SandMatch

> Полный обзор всех модулей системы с указанием файлов backend, frontend, БД, API и настроек.

## Легенда

- **Backend** - Django приложения, API views, сервисы
- **Frontend** - React компоненты и страницы
- **База данных** - Django модели и таблицы
- **API Endpoints** - REST API маршруты
- **Настройки** - Конфигурационные файлы и переменные окружения

---

## Турнирные системы

### 1. Круговая система (Round Robin)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/api_views.py` (group_schedule)<br>`apps/tournaments/services/round_robin.py`<br>`apps/tournaments/api_new_round_robin.py` |
| **Frontend** | `frontend/src/pages/TournamentDetailPage.tsx`<br>`frontend/src/components/RoundRobinGroupTable.tsx`<br>`frontend/src/components/DraggableParticipantList.tsx` |
| **База данных** | `apps/tournaments/models.py` (Tournament, TournamentEntry)<br>`apps/matches/models.py` (Match, MatchSet) |
| **API Endpoints** | `GET /api/tournaments/{id}/group_schedule/`<br>`POST /api/tournaments/{id}/add_participant/`<br>`POST /api/tournaments/{id}/auto_seed/`<br>`POST /api/tournaments/{id}/clear_tables/` |
| **Настройки** | `TOURNAMENT_SYSTEM = 'round_robin'` |

### 2. Олимпийская система (Knockout)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/api_views.py` (bracket_draw, seed_bracket)<br>`apps/tournaments/services/knockout.py`<br>`apps/tournaments/api_new_knockout.py`<br>`apps/tournaments/models.py` (KnockoutBracket, DrawPosition) |
| **Frontend** | `frontend/src/pages/KnockoutPage.tsx`<br>`frontend/src/components/BracketWithSVGConnectors.tsx`<br>`frontend/src/components/RoundComponent.tsx`<br>`frontend/src/styles/knockout-dragdrop.css` |
| **База данных** | `apps/tournaments/models.py` (KnockoutBracket, DrawPosition)<br>`apps/matches/models.py` (Match) |
| **API Endpoints** | `GET /api/tournaments/{id}/brackets/{bid}/draw/`<br>`GET /api/tournaments/{id}/brackets/{bid}/bye_positions/`<br>`POST /api/tournaments/{id}/seed_bracket/`<br>`POST /api/tournaments/{id}/brackets/{bid}/assign_participant/`<br>`DELETE /api/tournaments/{id}/brackets/{bid}/remove_participant/` |
| **Настройки** | `TOURNAMENT_SYSTEM = 'knockout'`<br>ITF правила для BYE |

### 3. Кинг система (King)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/api_views.py` (king_schedule)<br>`apps/tournaments/services/king.py`<br>`apps/tournaments/api_new_king.py` |
| **Frontend** | `frontend/src/pages/KingPage.tsx`<br>`frontend/src/components/KingGroupTable.tsx` |
| **База данных** | `apps/tournaments/models.py` (Tournament, TournamentEntry)<br>`apps/matches/models.py` (Match) |
| **API Endpoints** | `GET /api/tournaments/{id}/king_schedule/`<br>`POST /api/tournaments/{id}/add_participant/`<br>`POST /api/tournaments/{id}/auto_seed/` |
| **Настройки** | `TOURNAMENT_SYSTEM = 'king'` |

---

## Рейтинговые системы

### 4. Рейтинг BP (Beach Play)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/players/models.py` (Player.current_rating)<br>`apps/players/api_views.py`<br>`apps/players/services/rating.py` |
| **Frontend** | `frontend/src/pages/RatingPage.tsx`<br>`frontend/src/pages/PlayerCardPage.tsx` |
| **База данных** | `apps/players/models.py` (Player)<br>`players_playerratinghistory` |
| **API Endpoints** | `GET /api/players/`<br>`GET /api/players/{id}/rating_history/` |
| **Настройки** | Формула BP в `services/rating.py` |

### 5. Рейтинг BTR (Beach Tennis Rating)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/btr/models.py` (BTRPlayer, BTRTournament)<br>`apps/btr/api_views.py`<br>`apps/btr/services/rating.py` |
| **Frontend** | `frontend/src/pages/BTRPlayerCardPage.tsx` |
| **База данных** | `apps/btr/models.py` (BTRPlayer, BTRTournament, BTRMatch) |
| **API Endpoints** | `GET /api/btr/players/`<br>`POST /api/btr/sync/` |
| **Настройки** | `docs/BTR_TO_BP_RATING_MAPPING.md` |

---

## Статистика

### 6. Статистика игрока

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/players/api_views.py` (player_stats)<br>`apps/players/services/stats.py` |
| **Frontend** | `frontend/src/pages/PlayerCardPage.tsx`<br>`frontend/src/components/PlayerStatsPanel.tsx` |
| **База данных** | Агрегация из `apps/matches/models.py` |
| **API Endpoints** | `GET /api/players/{id}/stats/`<br>`GET /api/players/{id}/matches/` |
| **Настройки** | Метрики: win rate, tournaments, matches |

### 7. Статистика турниров

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/api_views.py` (tournament_stats)<br>`apps/tournaments/services/stats.py` |
| **Frontend** | `frontend/src/pages/StatsPage.tsx` |
| **База данных** | Агрегация из `apps/tournaments/models.py` |
| **API Endpoints** | `GET /api/tournaments/stats/` |
| **Настройки** | Метрики: total tournaments, participants |

### 8. Head-to-Head (H2H)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/players/api_views.py` (h2h)<br>`apps/players/services/h2h.py` |
| **Frontend** | `frontend/src/pages/PlayersH2HPage.tsx` |
| **База данных** | Фильтрация `apps/matches/models.py` |
| **API Endpoints** | `GET /api/players/h2h/?player1={id1}&player2={id2}` |
| **Настройки** | Метрики: wins, losses, sets |

---

## Управление данными

### 9. Управление игроками

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/players/models.py` (Player)<br>`apps/players/api_views.py`<br>`apps/players/admin.py` |
| **Frontend** | `frontend/src/pages/PlayersPage.tsx`<br>`frontend/src/components/AddPlayerModal.tsx` |
| **База данных** | `apps/players/models.py` (Player) |
| **API Endpoints** | `GET/POST/PUT/DELETE /api/players/` |
| **Настройки** | Поля: first_name, last_name, gender, rating |

### 10. Управление командами

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/teams/models.py` (Team)<br>`apps/teams/api_views.py` |
| **Frontend** | `frontend/src/components/TeamPicker.tsx` |
| **База данных** | `apps/teams/models.py` (Team) |
| **API Endpoints** | `GET/POST /api/teams/` |
| **Настройки** | Поля: player_1, player_2 (nullable) |

### 11. Управление площадками

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/venues/models.py` (Venue)<br>`apps/venues/api_views.py` |
| **Frontend** | `frontend/src/components/VenuePicker.tsx` |
| **База данных** | `apps/venues/models.py` (Venue) |
| **API Endpoints** | `GET/POST /api/venues/` |
| **Настройки** | Поля: name, address, courts_count |

### 12. Управление матчами

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/matches/models.py` (Match, MatchSet)<br>`apps/matches/api_views.py`<br>`apps/matches/services/match.py` |
| **Frontend** | `frontend/src/components/MatchScoreDialog.tsx`<br>`frontend/src/components/MatchActionDialog.tsx` |
| **База данных** | `apps/matches/models.py` (Match, MatchSet, MatchSpecialOutcome) |
| **API Endpoints** | `POST /api/matches/{id}/update_score/`<br>`POST /api/matches/{id}/start/`<br>`POST /api/matches/{id}/cancel/` |
| **Настройки** | Статусы: scheduled, in_progress, completed |

---

## Пользовательские функции

### 13. Аутентификация и авторизация

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/accounts/models.py` (CustomUser)<br>`apps/accounts/api_views.py` (LoginView, RegisterView)<br>`sandmatch/settings/base.py` (JWT) |
| **Frontend** | `frontend/src/pages/LoginPage.tsx`<br>`frontend/src/pages/RegisterPage.tsx`<br>`frontend/src/pages/PasswordResetRequestPage.tsx`<br>`frontend/src/pages/PasswordResetConfirmPage.tsx`<br>`frontend/src/contexts/AuthContext.tsx`<br>`frontend/src/services/auth.ts` |
| **База данных** | `apps/accounts/models.py` (CustomUser) |
| **API Endpoints** | `POST /api/auth/login/`<br>`POST /api/auth/register/`<br>`POST /api/auth/logout/`<br>`POST /api/auth/refresh/`<br>`POST /api/auth/password-reset/` |
| **Настройки** | `JWT_SECRET_KEY`, `ACCESS_TOKEN_LIFETIME` в `.env` |

### 14. Личный кабинет

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/accounts/api_views.py` (ProfileView) |
| **Frontend** | `frontend/src/pages/ProfilePage.tsx` |
| **База данных** | `apps/accounts/models.py` (CustomUser) |
| **API Endpoints** | `GET/PUT /api/auth/profile/` |
| **Настройки** | Поля: email, first_name, last_name, avatar |

### 15. Роли и права доступа

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/accounts/models.py` (CustomUser.role)<br>`apps/accounts/permissions.py` (IsAdmin, IsOrganizer) |
| **Frontend** | `frontend/src/pages/UserRolesPage.tsx`<br>`frontend/src/contexts/AuthContext.tsx` |
| **База данных** | `apps/accounts/models.py` (CustomUser.role) |
| **API Endpoints** | `GET /api/users/roles/`<br>`PUT /api/users/{id}/role/` |
| **Настройки** | Роли: PLAYER, ORGANIZER, ADMIN |

### 16. Регистрация на турниры

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/models.py` (TournamentRegistration)<br>`apps/tournaments/services/registration_service.py`<br>`apps/tournaments/signals.py` |
| **Frontend** | `frontend/src/components/MiniApp/RegistrationModal.tsx`<br>`frontend/src/components/MiniApp/CancelRegistrationModal.tsx`<br>`frontend/src/components/MiniApp/PartnerSearchModal.tsx` |
| **База данных** | `apps/tournaments/models.py` (TournamentRegistration, TournamentEntry) |
| **API Endpoints** | `POST /api/miniapp/tournaments/{id}/register/`<br>`POST /api/miniapp/tournaments/{id}/cancel/`<br>`GET /api/miniapp/tournaments/{id}/registrations/` |
| **Настройки** | Статусы: looking_for_partner, invited, main_list, reserve_list |

---

## Telegram интеграция

### 17. Telegram бот

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/telegram_bot/bot.py` (основной бот)<br>`apps/telegram_bot/handlers/` (обработчики команд)<br>`apps/telegram_bot/models.py` (TelegramUser) |
| **Frontend** | Нет (серверная логика) |
| **База данных** | `apps/telegram_bot/models.py` (TelegramUser, TelegramChat) |
| **API Endpoints** | Webhook: `POST /api/telegram/webhook/`<br>`GET /api/telegram/users/` |
| **Настройки** | `TELEGRAM_BOT_TOKEN` в `.env`<br>`TELEGRAM_WEBHOOK_URL` |

### 18. Mini-App (Telegram)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/telegram_bot/api_views.py` (MiniAppViewSet)<br>`apps/telegram_bot/api_serializers.py` |
| **Frontend** | `frontend/src/pages/MiniApp/MiniAppHome.tsx`<br>`frontend/src/pages/MiniApp/MiniAppTournaments.tsx`<br>`frontend/src/pages/MiniApp/MiniAppTournamentDetail.tsx`<br>`frontend/src/pages/MiniApp/MiniAppProfile.tsx`<br>`frontend/src/pages/MiniApp/MiniAppMyTournaments.tsx`<br>`frontend/src/pages/MiniApp/MiniAppInvitations.tsx`<br>`frontend/src/api/miniApp.ts` |
| **База данных** | `apps/telegram_bot/models.py` (TelegramUser)<br>`apps/tournaments/models.py` (TournamentRegistration) |
| **API Endpoints** | `GET /api/miniapp/tournaments/`<br>`GET /api/miniapp/profile/`<br>`POST /api/miniapp/tournaments/{id}/register/` |
| **Настройки** | `TELEGRAM_BOT_USERNAME` для WebApp URL |

### 19. Уведомления

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/telegram_bot/services/notifications.py`<br>`apps/telegram_bot/tasks.py` (Celery задачи) |
| **Frontend** | Нет (серверная логика) |
| **База данных** | `apps/telegram_bot/models.py` (TelegramUser) |
| **API Endpoints** | Внутренние вызовы через Celery |
| **Настройки** | Типы уведомлений: tournament_start, match_ready, registration_confirmed |

---

## Дополнительные функции

### 20. Судейство (Referee)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/api_views.py` (referee endpoints) |
| **Frontend** | `frontend/src/pages/RefereePage.tsx` |
| **База данных** | `apps/matches/models.py` (Match) |
| **API Endpoints** | `GET /api/referee/matches/`<br>`POST /api/referee/matches/{id}/score/` |
| **Настройки** | Права доступа для судей |

### 21. Экспорт данных (PNG/PDF)

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/tournaments/services/export.py` (генерация PDF) |
| **Frontend** | `frontend/src/utils/exportToPNG.ts`<br>`frontend/src/components/ExportButton.tsx` |
| **База данных** | Чтение данных из Tournament, Match |
| **API Endpoints** | `GET /api/tournaments/{id}/export/pdf/` |
| **Настройки** | Библиотеки: html2canvas (PNG), ReportLab (PDF) |

### 22. CI/CD и деплой

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `Dockerfile`<br>`docker-compose.yml`<br>`docker-compose.prod.yml`<br>`scripts/entrypoint.sh`<br>`deploy/deploy.sh` |
| **Frontend** | `frontend/package.json` (build scripts)<br>`frontend/vite.config.ts` |
| **База данных** | Миграции в `apps/*/migrations/` |
| **API Endpoints** | Нет (инфраструктура) |
| **Настройки** | `.github/workflows/ci.yml`<br>`.github/workflows/cd.yml`<br>`.env`, `.env.example`<br>`requirements.txt` |

### 23. Health checks и мониторинг

| Компонент | Файлы |
|-----------|-------|
| **Backend** | `apps/core/views.py` (health endpoint)<br>`deploy/deploy.sh` (smoke tests) |
| **Frontend** | Нет (серверная логика) |
| **База данных** | Проверка подключения к БД |
| **API Endpoints** | `GET /api/health/`<br>`GET /api/health/deep/` |
| **Настройки** | Проверки: БД, Redis, Celery, статика |

---

## Дополнительная документация

- **Архитектура синхронизации**: `docs/SYNCHRONIZATION_ARCHITECTURE.md`
- **Маппинг BTR → BP**: `docs/BTR_TO_BP_RATING_MAPPING.md`
- **План деплоя**: `DEPLOYMENT_PLAN.md`
- **README**: `README.md`

---

## Структура проекта

```
SandMatch/
├── apps/                      # Django приложения
│   ├── accounts/             # Пользователи и аутентификация
│   ├── btr/                  # BTR рейтинг
│   ├── matches/              # Матчи и счет
│   ├── players/              # Игроки
│   ├── teams/                # Команды
│   ├── telegram_bot/         # Telegram бот и Mini-App
│   ├── tournaments/          # Турниры (RR, KO, King)
│   └── venues/               # Площадки
├── frontend/                  # React приложение
│   ├── src/
│   │   ├── pages/            # Страницы
│   │   ├── components/       # Компоненты
│   │   ├── contexts/         # React контексты
│   │   ├── services/         # API сервисы
│   │   └── api/              # API клиенты
│   └── public/               # Статические файлы
├── sandmatch/                 # Django настройки
│   └── settings/             # base, local, prod
├── scripts/                   # Вспомогательные скрипты
├── deploy/                    # Скрипты деплоя
├── docs/                      # Документация
├── .github/workflows/         # GitHub Actions CI/CD
├── Dockerfile                 # Docker образ
├── docker-compose.yml         # Docker Compose
└── requirements.txt           # Python зависимости
```

---

**Дата создания**: 29 декабря 2024  
**Версия**: 1.0
