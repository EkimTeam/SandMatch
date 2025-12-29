# Индекс документации SandMatch

## 📚 Основные документы

### Обзор системы
- **[SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)** - Сводная таблица всех 23 функциональных модулей
- **[SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md)** - Mermaid диаграммы архитектуры системы

### Детальная документация модулей
- **[modules/](modules/)** - Подробное описание каждого из 16 ключевых модулей
  - [Round Robin](modules/ROUND_ROBIN.md), [Knockout](modules/KNOCKOUT.md), [King](modules/KING.md)
  - [BP Rating](modules/RATING_BP.md), [BTR Rating](modules/RATING_BTR.md)
  - [Players](modules/PLAYERS.md), [Teams](modules/TEAMS.md), [Matches](modules/MATCHES.md)
  - [Auth](modules/AUTH.md), [Profile](modules/PROFILE.md), [Roles](modules/ROLES.md)
  - [Registration](modules/REGISTRATION.md), [Telegram Bot](modules/TELEGRAM_BOT.md), [Mini-App](modules/MINIAPP.md), [Notifications](modules/NOTIFICATIONS.md)

### Техническая документация
- **[SYNCHRONIZATION_ARCHITECTURE.md](SYNCHRONIZATION_ARCHITECTURE.md)** - Архитектура синхронизации TournamentEntry ↔ TournamentRegistration
- **[BTR_TO_BP_RATING_MAPPING.md](BTR_TO_BP_RATING_MAPPING.md)** - Правила маппинга рейтинга BTR → BP
- **[DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md)** - План деплоя и обслуживания
- **[README.md](../README.md)** - Основная документация проекта

---

## 🔍 Быстрый поиск по функционалу

### Турнирные системы
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **Round Robin** | `apps/tournaments/services/round_robin.py` | `pages/TournamentDetailPage.tsx` | [SYSTEM_OVERVIEW.md#1](SYSTEM_OVERVIEW.md#1-круговая-система-round-robin) |
| **Knockout** | `apps/tournaments/services/knockout.py` | `pages/KnockoutPage.tsx` | [SYSTEM_OVERVIEW.md#2](SYSTEM_OVERVIEW.md#2-олимпийская-система-knockout) |
| **King** | `apps/tournaments/services/king.py` | `pages/KingPage.tsx` | [SYSTEM_OVERVIEW.md#3](SYSTEM_OVERVIEW.md#3-кинг-система-king) |

### Рейтинги
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **BP Rating** | `apps/players/services/rating.py` | `pages/RatingPage.tsx` | [SYSTEM_OVERVIEW.md#4](SYSTEM_OVERVIEW.md#4-рейтинг-bp-beach-play) |
| **BTR Rating** | `apps/btr/services/rating.py` | `pages/BTRPlayerCardPage.tsx` | [SYSTEM_OVERVIEW.md#5](SYSTEM_OVERVIEW.md#5-рейтинг-btr-beach-tennis-rating) |

### Статистика
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **Player Stats** | `apps/players/services/stats.py` | `pages/PlayerCardPage.tsx` | [SYSTEM_OVERVIEW.md#6](SYSTEM_OVERVIEW.md#6-статистика-игрока) |
| **Tournament Stats** | `apps/tournaments/services/stats.py` | `pages/StatsPage.tsx` | [SYSTEM_OVERVIEW.md#7](SYSTEM_OVERVIEW.md#7-статистика-турниров) |
| **H2H** | `apps/players/services/h2h.py` | `pages/PlayersH2HPage.tsx` | [SYSTEM_OVERVIEW.md#8](SYSTEM_OVERVIEW.md#8-head-to-head-h2h) |

### Управление данными
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **Players** | `apps/players/` | `pages/PlayersPage.tsx` | [SYSTEM_OVERVIEW.md#9](SYSTEM_OVERVIEW.md#9-управление-игроками) |
| **Teams** | `apps/teams/` | `components/TeamPicker.tsx` | [SYSTEM_OVERVIEW.md#10](SYSTEM_OVERVIEW.md#10-управление-командами) |
| **Venues** | `apps/venues/` | `components/VenuePicker.tsx` | [SYSTEM_OVERVIEW.md#11](SYSTEM_OVERVIEW.md#11-управление-площадками) |
| **Matches** | `apps/matches/` | `components/MatchScoreDialog.tsx` | [SYSTEM_OVERVIEW.md#12](SYSTEM_OVERVIEW.md#12-управление-матчами) |

### Пользователи
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **Auth** | `apps/accounts/api_views.py` | `pages/LoginPage.tsx` | [SYSTEM_OVERVIEW.md#13](SYSTEM_OVERVIEW.md#13-аутентификация-и-авторизация) |
| **Profile** | `apps/accounts/api_views.py` | `pages/ProfilePage.tsx` | [SYSTEM_OVERVIEW.md#14](SYSTEM_OVERVIEW.md#14-личный-кабинет) |
| **Roles** | `apps/accounts/permissions.py` | `pages/UserRolesPage.tsx` | [SYSTEM_OVERVIEW.md#15](SYSTEM_OVERVIEW.md#15-роли-и-права-доступа) |
| **Registration** | `apps/tournaments/services/registration_service.py` | `components/MiniApp/RegistrationModal.tsx` | [SYSTEM_OVERVIEW.md#16](SYSTEM_OVERVIEW.md#16-регистрация-на-турниры) |

### Telegram
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **Bot** | `apps/telegram_bot/bot.py` | - | [SYSTEM_OVERVIEW.md#17](SYSTEM_OVERVIEW.md#17-telegram-бот) |
| **Mini-App** | `apps/telegram_bot/api_views.py` | `pages/MiniApp/` | [SYSTEM_OVERVIEW.md#18](SYSTEM_OVERVIEW.md#18-mini-app-telegram) |
| **Notifications** | `apps/telegram_bot/services/notifications.py` | - | [SYSTEM_OVERVIEW.md#19](SYSTEM_OVERVIEW.md#19-уведомления) |

### Дополнительно
| Функционал | Backend | Frontend | Документация |
|------------|---------|----------|--------------|
| **Referee** | `apps/tournaments/api_views.py` | `pages/RefereePage.tsx` | [SYSTEM_OVERVIEW.md#20](SYSTEM_OVERVIEW.md#20-судейство-referee) |
| **Export** | `apps/tournaments/services/export.py` | `utils/exportToPNG.ts` | [SYSTEM_OVERVIEW.md#21](SYSTEM_OVERVIEW.md#21-экспорт-данных-pngpdf) |
| **CI/CD** | `.github/workflows/`, `deploy/` | - | [SYSTEM_OVERVIEW.md#22](SYSTEM_OVERVIEW.md#22-cicd-и-деплой) |
| **Health** | `apps/core/views.py` | - | [SYSTEM_OVERVIEW.md#23](SYSTEM_OVERVIEW.md#23-health-checks-и-мониторинг) |

---

## 📂 Структура проекта

```
SandMatch/
├── apps/                      # Django приложения (Backend)
│   ├── accounts/             # Аутентификация и пользователи
│   ├── btr/                  # BTR рейтинг
│   ├── matches/              # Матчи и счет
│   ├── players/              # Игроки
│   ├── teams/                # Команды
│   ├── telegram_bot/         # Telegram бот и Mini-App
│   ├── tournaments/          # Турниры (RR, KO, King)
│   └── venues/               # Площадки
│
├── frontend/                  # React приложение (Frontend)
│   ├── src/
│   │   ├── pages/            # Страницы приложения
│   │   ├── components/       # React компоненты
│   │   ├── contexts/         # React контексты (Auth, Theme)
│   │   ├── services/         # API сервисы
│   │   ├── api/              # API клиенты
│   │   └── utils/            # Утилиты
│   └── public/               # Статические файлы
│
├── docs/                      # Документация
│   ├── INDEX.md              # Этот файл
│   ├── SYSTEM_OVERVIEW.md    # Сводная таблица
│   ├── SYSTEM_ARCHITECTURE.md # Mermaid диаграммы
│   └── ...                   # Другие документы
│
├── .github/workflows/         # GitHub Actions CI/CD
│   ├── ci.yml                # Continuous Integration
│   └── cd.yml                # Continuous Deployment
│
├── deploy/                    # Скрипты деплоя
│   └── deploy.sh             # Основной скрипт деплоя
│
├── scripts/                   # Вспомогательные скрипты
│   └── entrypoint.sh         # Docker entrypoint
│
├── Dockerfile                 # Docker образ
├── docker-compose.yml         # Docker Compose (dev)
├── docker-compose.prod.yml    # Docker Compose (prod)
├── requirements.txt           # Python зависимости
└── README.md                  # Основная документация
```

---

## 🔗 Полезные ссылки

### Внутренние ресурсы
- [Сводная таблица функционала](SYSTEM_OVERVIEW.md)
- [Архитектурные диаграммы](SYSTEM_ARCHITECTURE.md)
- [План деплоя](../DEPLOYMENT_PLAN.md)
- [README](../README.md)

### Внешние ресурсы
- [Django Documentation](https://docs.djangoproject.com/)
- [React Documentation](https://react.dev/)
- [Django REST Framework](https://www.django-rest-framework.org/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)

---

## 📝 Как использовать эту документацию

1. **Для новых разработчиков**: Начните с [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) для общего понимания системы
2. **Для понимания архитектуры**: Изучите [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) с диаграммами
3. **Для работы с конкретным функционалом**: Используйте таблицы выше для быстрого поиска нужных файлов
4. **Для деплоя**: Следуйте [DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md) и [README.md](../README.md)

---

**Последнее обновление**: 29 декабря 2024  
**Версия**: 1.0
