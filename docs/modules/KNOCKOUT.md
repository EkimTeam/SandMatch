# Олимпийская система (Knockout) - Главный документ

## Описание

Олимпийская система (плей-офф, knockout) - турнирная система с одним выбыванием. Полная детальная документация разбита на 5 частей для удобства навигации.

---

## Содержание документации

### [Часть 1: Обзор и архитектура](KNOCKOUT_01_OVERVIEW.md)
- Описание системы и её возможностей
- Backend компоненты (сервисы, API, модели)
- Frontend компоненты (страницы, компоненты, стили)
- Константы и конфигурация
- Связь позиций с матчами
- Структура раундов

### [Часть 2: BYE позиции и ITF правила](KNOCKOUT_02_BYE.md)
- Что такое BYE и зачем они нужны
- ITF правила размещения BYE
- Алгоритм расчета BYE позиций
- Примеры расчета для разных размеров сетки
- Создание BYE в базе данных
- Обработка BYE в матчах
- Отображение BYE на Frontend
- Пересчет BYE при изменении участников

### [Часть 3: Автопосев участников](KNOCKOUT_03_SEEDING.md)
- Правила посева по ITF
- Количество сеянных участников
- Позиции сеянных для разных размеров сетки
- Алгоритм автопосева
- Сортировка по рейтингу
- Специальная обработка нулевых рейтингов
- Расстановка несеянных участников
- Назначение в матчи первого раунда

### [Часть 4: API и интеграция](KNOCKOUT_04_API.md)
- Все API endpoints с примерами
- Создание турнира
- Получение данных сетки
- Автопосев
- Назначение/удаление участников
- Очистка сетки
- Изменение размера сетки
- Фиксация участников
- Обработка ошибок

### [Часть 5: Frontend и UI/UX](KNOCKOUT_05_FRONTEND.md)
- Архитектура React компонентов
- Состояние и хуки
- Drag & Drop реализация
- Отображение сетки с SVG
- Интерактивность и анимации
- Валидация и обработка ошибок
- Адаптивный дизайн
- Troubleshooting

---

## Быстрый справочник

### Основные файлы

**Backend:**
- `apps/tournaments/services/knockout.py` (643 строки) - вся логика
- `apps/tournaments/api_views.py` - API endpoints
- `apps/tournaments/api_new_knockout.py` - создание турнира

**Frontend:**
- `frontend/src/pages/KnockoutPage.tsx` (1000+ строк) - главная страница
- `frontend/src/components/BracketWithSVGConnectors.tsx` - сетка
- `frontend/src/components/DraggableParticipantList.tsx` - drag&drop

**Models:**
- `KnockoutBracket` - сетка турнира
- `DrawPosition` - позиции жеребьевки
- `Match` - матчи
- `TournamentEntry` - участники

### Ключевые API

```
GET    /api/tournaments/{id}/brackets/{bid}/draw/
GET    /api/tournaments/{id}/brackets/{bid}/bye_positions/
POST   /api/tournaments/{id}/seed_bracket/
POST   /api/tournaments/{id}/brackets/{bid}/assign_participant/
DELETE /api/tournaments/{id}/brackets/{bid}/remove_participant/
POST   /api/tournaments/{id}/clear_bracket/
POST   /api/tournaments/{id}/edit_settings/
```

### Размеры сетки

```
4, 8, 16, 32, 64, 128, 256, 512 (степени двойки)
```

### Количество сеянных

```
Сетка 4  → 2 сеянных
Сетка 8  → 2 сеянных
Сетка 16 → 4 сеянных
Сетка 32 → 8 сеянных
Сетка 64 → 16 сеянных
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
