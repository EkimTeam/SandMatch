# Архитектура системы SandMatch

## Общая архитектура

```mermaid
graph TB
    subgraph "Frontend Layer"
        WEB[Web App<br/>React + TypeScript]
        MINIAPP[Mini-App<br/>Telegram WebApp]
    end
    
    subgraph "API Layer"
        API[Django REST API<br/>JWT Auth]
    end
    
    subgraph "Backend Services"
        DJANGO[Django<br/>Business Logic]
        CELERY[Celery<br/>Async Tasks]
        TGBOT[Telegram Bot<br/>python-telegram-bot]
    end
    
    subgraph "Data Layer"
        DB[(PostgreSQL<br/>Main Database)]
        REDIS[(Redis<br/>Cache + Queue)]
    end
    
    subgraph "External Services"
        TG[Telegram API]
        BTR[BTR Rating API]
    end
    
    WEB -->|REST API| API
    MINIAPP -->|REST API| API
    API --> DJANGO
    DJANGO --> DB
    DJANGO --> REDIS
    DJANGO --> CELERY
    CELERY --> REDIS
    CELERY --> DB
    TGBOT --> TG
    TGBOT --> DB
    DJANGO --> BTR
    CELERY --> TG
    
    style WEB fill:#61dafb
    style MINIAPP fill:#0088cc
    style API fill:#092e20
    style DJANGO fill:#092e20
    style DB fill:#336791
    style REDIS fill:#dc382d
```

---

## Модульная архитектура

```mermaid
graph LR
    subgraph "Core Modules"
        ACCOUNTS[Accounts<br/>Auth & Users]
        PLAYERS[Players<br/>Player Management]
        TEAMS[Teams<br/>Team Management]
        VENUES[Venues<br/>Venue Management]
    end
    
    subgraph "Tournament Systems"
        RR[Round Robin<br/>Круговая система]
        KO[Knockout<br/>Олимпийская система]
        KING[King<br/>Кинг система]
    end
    
    subgraph "Match Management"
        MATCHES[Matches<br/>Match Logic]
        SCORE[Score Tracking<br/>Sets & Points]
    end
    
    subgraph "Rating Systems"
        BP[BP Rating<br/>Beach Play]
        BTR_MOD[BTR Rating<br/>Beach Tennis]
    end
    
    subgraph "Telegram Integration"
        BOT[Telegram Bot<br/>Commands]
        MINIAPP_BE[Mini-App Backend<br/>API]
        NOTIF[Notifications<br/>Celery Tasks]
    end
    
    ACCOUNTS --> PLAYERS
    PLAYERS --> TEAMS
    TEAMS --> RR
    TEAMS --> KO
    TEAMS --> KING
    RR --> MATCHES
    KO --> MATCHES
    KING --> MATCHES
    MATCHES --> SCORE
    MATCHES --> BP
    BTR_MOD --> BP
    BOT --> MINIAPP_BE
    MINIAPP_BE --> NOTIF
    
    style RR fill:#90ee90
    style KO fill:#ffa500
    style KING fill:#ffd700
    style BP fill:#87ceeb
    style BTR_MOD fill:#9370db
```

---

## Турнирные системы - детальная схема

```mermaid
graph TD
    START[Создание турнира] --> SYSTEM{Выбор системы}
    
    SYSTEM -->|Round Robin| RR_CREATE[Создать группы]
    SYSTEM -->|Knockout| KO_CREATE[Создать сетку]
    SYSTEM -->|King| KING_CREATE[Создать группы King]
    
    RR_CREATE --> RR_SEED[Автопосев/<br/>Ручная расстановка]
    KO_CREATE --> KO_SEED[Автопосев/<br/>Drag & Drop]
    KING_CREATE --> KING_SEED[Автопосев/<br/>Ручная расстановка]
    
    RR_SEED --> RR_SCHEDULE[Генерация<br/>расписания]
    KO_SEED --> KO_BRACKET[Формирование<br/>сетки с BYE]
    KING_SEED --> KING_SCHEDULE[Генерация<br/>расписания King]
    
    RR_SCHEDULE --> LOCK[Фиксация участников]
    KO_BRACKET --> LOCK
    KING_SCHEDULE --> LOCK
    
    LOCK --> ACTIVE[Турнир активен]
    ACTIVE --> MATCHES[Проведение матчей]
    MATCHES --> COMPLETE[Турнир завершен]
    COMPLETE --> RATING[Пересчет рейтинга]
    
    style RR_CREATE fill:#90ee90
    style KO_CREATE fill:#ffa500
    style KING_CREATE fill:#ffd700
    style ACTIVE fill:#87ceeb
    style COMPLETE fill:#98fb98
```

---

## Регистрация на турнир (Mini-App)

```mermaid
sequenceDiagram
    participant U as User (Telegram)
    participant MA as Mini-App
    participant API as Backend API
    participant DB as Database
    participant TG as Telegram Bot
    
    U->>MA: Открыть турнир
    MA->>API: GET /miniapp/tournaments/{id}
    API->>DB: Получить данные турнира
    DB-->>API: Данные турнира
    API-->>MA: Детали турнира
    
    U->>MA: Нажать "Зарегистрироваться"
    MA->>MA: Открыть RegistrationModal
    
    alt Регистрация с напарником
        U->>MA: Выбрать напарника
        MA->>API: POST /miniapp/tournaments/{id}/register/<br/>{partner_id}
    else Поиск напарника
        U->>MA: "Ищу напарника"
        MA->>API: POST /miniapp/tournaments/{id}/register/<br/>{looking_for_partner: true}
    end
    
    API->>DB: Создать TournamentRegistration
    API->>DB: Создать TournamentEntry (если пара)
    DB-->>API: OK
    API-->>MA: Регистрация успешна
    
    API->>TG: Отправить уведомление
    TG-->>U: Уведомление в Telegram
    
    MA->>MA: Обновить список участников
```

---

## Синхронизация TournamentEntry ↔ TournamentRegistration

```mermaid
graph TB
    subgraph "Web Interface"
        WEB_ADD[Добавить участника<br/>через веб]
    end
    
    subgraph "Mini-App"
        MA_REG[Регистрация<br/>через Mini-App]
    end
    
    WEB_ADD --> TE_CREATE[TournamentEntry.create]
    MA_REG --> TR_CREATE[TournamentRegistration.create]
    
    TE_CREATE --> SIGNAL1[post_save signal]
    TR_CREATE --> SIGNAL2[post_save signal]
    
    SIGNAL1 --> SYNC1[Создать/обновить<br/>TournamentRegistration]
    SIGNAL2 --> SYNC2[Создать/обновить<br/>TournamentEntry]
    
    SYNC1 --> RECALC[Пересчет очереди]
    SYNC2 --> RECALC
    
    RECALC --> UPDATE[Обновить статусы:<br/>main_list, reserve_list]
    
    style TE_CREATE fill:#90ee90
    style TR_CREATE fill:#87ceeb
    style RECALC fill:#ffa500
```

---

## Рейтинговая система

```mermaid
graph TD
    MATCH_END[Матч завершен] --> UPDATE_SCORE[Обновить счет]
    UPDATE_SCORE --> CHECK_TOURN{Турнир<br/>завершен?}
    
    CHECK_TOURN -->|Нет| WAIT[Ожидание]
    CHECK_TOURN -->|Да| CALC_RATING[Расчет рейтинга]
    
    CALC_RATING --> BP_CALC[Формула BP]
    BP_CALC --> UPDATE_PLAYER[Обновить Player.current_rating]
    UPDATE_PLAYER --> HISTORY[Сохранить в<br/>PlayerRatingHistory]
    
    subgraph "BTR Integration"
        BTR_SYNC[Синхронизация BTR] --> BTR_FETCH[Получить данные BTR]
        BTR_FETCH --> BTR_MAP[Маппинг BTR → BP]
        BTR_MAP --> BP_UPDATE[Обновить BP рейтинг]
    end
    
    HISTORY -.->|Периодически| BTR_SYNC
    
    style CALC_RATING fill:#87ceeb
    style BP_CALC fill:#90ee90
    style BTR_MAP fill:#9370db
```

---

## CI/CD Pipeline

```mermaid
graph LR
    PUSH[git push main] --> CI[GitHub Actions CI]
    
    CI --> BUILD_FE[Build Frontend<br/>npm run build]
    CI --> TEST_BE[Test Backend<br/>Django checks]
    
    BUILD_FE --> DOCKER[Build Docker Image]
    TEST_BE --> DOCKER
    
    DOCKER --> PUSH_IMG[Push to GHCR<br/>ghcr.io/ekimteam/sandmatch/web]
    
    PUSH_IMG --> CD[GitHub Actions CD]
    
    CD --> SSH[SSH to Production]
    SSH --> PULL[docker compose pull]
    PULL --> MIGRATE[Run Migrations]
    MIGRATE --> STATIC[collectstatic]
    STATIC --> RESTART[docker compose up -d]
    
    RESTART --> HEALTH[Health Checks]
    HEALTH --> SMOKE[Smoke Tests]
    SMOKE --> DONE[✅ Deployed]
    
    style CI fill:#2088ff
    style CD fill:#28a745
    style DONE fill:#90ee90
```

---

## Структура базы данных (основные таблицы)

```mermaid
erDiagram
    CUSTOMUSER ||--o{ PLAYER : "creates"
    PLAYER ||--o{ TEAM : "player_1"
    PLAYER ||--o{ TEAM : "player_2"
    TEAM ||--o{ TOURNAMENTENTRY : "participates"
    TOURNAMENT ||--o{ TOURNAMENTENTRY : "has"
    TOURNAMENT ||--o{ MATCH : "contains"
    TOURNAMENT ||--o{ KNOCKOUTBRACKET : "has"
    KNOCKOUTBRACKET ||--o{ DRAWPOSITION : "has"
    MATCH ||--o{ MATCHSET : "has"
    TEAM ||--o{ MATCH : "team_1"
    TEAM ||--o{ MATCH : "team_2"
    PLAYER ||--o{ PLAYERRATINGHISTORY : "has"
    CUSTOMUSER ||--o{ TELEGRAMUSER : "linked"
    TOURNAMENT ||--o{ TOURNAMENTREGISTRATION : "has"
    TELEGRAMUSER ||--o{ TOURNAMENTREGISTRATION : "registers"
    
    CUSTOMUSER {
        int id PK
        string email
        string role
        datetime created_at
    }
    
    PLAYER {
        int id PK
        string first_name
        string last_name
        string gender
        int current_rating
        int peak_rating
    }
    
    TEAM {
        int id PK
        int player_1_id FK
        int player_2_id FK
    }
    
    TOURNAMENT {
        int id PK
        string name
        string system
        string status
        int planned_participants
        int created_by_id FK
    }
    
    TOURNAMENTENTRY {
        int id PK
        int tournament_id FK
        int team_id FK
        int group_index
        int row_index
    }
    
    MATCH {
        int id PK
        int tournament_id FK
        int team_1_id FK
        int team_2_id FK
        string status
        int round_index
    }
    
    KNOCKOUTBRACKET {
        int id PK
        int tournament_id FK
        int size
        bool has_third_place
    }
    
    DRAWPOSITION {
        int id PK
        int bracket_id FK
        int position
        int entry_id FK
        string source
    }
```

---

**Дата создания**: 29 декабря 2024  
**Версия**: 1.0
