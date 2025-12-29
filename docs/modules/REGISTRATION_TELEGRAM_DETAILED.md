# Регистрация на турниры и Telegram интеграция - Детальная документация

## Описание

Комплексный модуль регистрации на турниры через Telegram Mini-App с двусторонней синхронизацией, системой очередей и уведомлениями.

---

## Регистрация на турниры

### Модели

**TournamentRegistration:**
```python
class TournamentRegistration(models.Model):
    class Status(models.TextChoices):
        LOOKING_FOR_PARTNER = 'looking_for_partner', 'Ищет напарника'
        INVITED = 'invited', 'Приглашен в пару'
        MAIN_LIST = 'main_list', 'Основной список'
        RESERVE_LIST = 'reserve_list', 'Резервный список'
    
    tournament = models.ForeignKey(Tournament, related_name='registrations')
    player = models.ForeignKey(Player, related_name='registrations')
    partner = models.ForeignKey(Player, null=True, related_name='partner_registrations')
    status = models.CharField(choices=Status.choices, default=Status.LOOKING_FOR_PARTNER)
    queue_position = models.IntegerField(null=True)
    registered_at = models.DateTimeField(auto_now_add=True)
```

**TournamentEntry (основная таблица):**
```python
class TournamentEntry(models.Model):
    tournament = models.ForeignKey(Tournament, related_name='entries')
    team = models.ForeignKey(Team, related_name='tournament_entries')
    group_index = models.IntegerField(null=True)
    row_index = models.IntegerField(null=True)
    final_place = models.IntegerField(null=True)
```

### Синхронизация TournamentEntry ↔ TournamentRegistration

**Django Signals:**
```python
@receiver(post_save, sender=TournamentEntry)
def sync_entry_to_registration(sender, instance, created, **kwargs):
    """При создании TournamentEntry создать TournamentRegistration"""
    if created and not hasattr(instance, '_skip_sync'):
        team = instance.team
        
        # Для пары
        if team.player_2:
            TournamentRegistration.objects.get_or_create(
                tournament=instance.tournament,
                player=team.player_1,
                defaults={
                    'partner': team.player_2,
                    'status': 'main_list'
                }
            )
            TournamentRegistration.objects.get_or_create(
                tournament=instance.tournament,
                player=team.player_2,
                defaults={
                    'partner': team.player_1,
                    'status': 'main_list'
                }
            )

@receiver(post_save, sender=TournamentRegistration)
def sync_registration_to_entry(sender, instance, created, **kwargs):
    """При создании пары в Registration создать TournamentEntry"""
    if instance.status == 'main_list' and instance.partner:
        team = Team.objects.filter(
            Q(player_1=instance.player, player_2=instance.partner) |
            Q(player_1=instance.partner, player_2=instance.player)
        ).first()
        
        if not team:
            team = Team.objects.create(
                player_1=instance.player,
                player_2=instance.partner
            )
        
        if not TournamentEntry.objects.filter(tournament=instance.tournament, team=team).exists():
            TournamentEntry.objects.create(
                tournament=instance.tournament,
                team=team,
                _skip_sync=True
            )
```

### Процесс регистрации

**1. Одиночная регистрация:**
```python
def register_single(tournament: Tournament, player: Player):
    """Зарегистрировать игрока без напарника"""
    reg = TournamentRegistration.objects.create(
        tournament=tournament,
        player=player,
        partner=None,
        status='looking_for_partner'
    )
    
    # Пересчитать очередь
    recalculate_queue(tournament)
    
    return reg
```

**2. Регистрация пары:**
```python
def register_pair(tournament: Tournament, player1: Player, player2: Player):
    """Зарегистрировать пару"""
    # Создать регистрации для обоих
    reg1 = TournamentRegistration.objects.create(
        tournament=tournament,
        player=player1,
        partner=player2,
        status='main_list'
    )
    
    reg2 = TournamentRegistration.objects.create(
        tournament=tournament,
        player=player2,
        partner=player1,
        status='main_list'
    )
    
    # Создать Team и TournamentEntry (через сигнал)
    recalculate_queue(tournament)
    
    return reg1, reg2
```

**3. Приглашение в пару:**
```python
def invite_partner(tournament: Tournament, inviter: Player, invited: Player):
    """Пригласить игрока в пару"""
    # Обновить статус приглашенного
    reg = TournamentRegistration.objects.get(
        tournament=tournament,
        player=invited,
        status='looking_for_partner'
    )
    
    reg.status = 'invited'
    reg.partner = inviter
    reg.save()
    
    # Отправить уведомление
    send_notification(invited, f"{inviter} приглашает вас в пару")
```

**4. Принятие приглашения:**
```python
def accept_invitation(tournament: Tournament, player: Player):
    """Принять приглашение в пару"""
    reg = TournamentRegistration.objects.get(
        tournament=tournament,
        player=player,
        status='invited'
    )
    
    partner = reg.partner
    
    # Обновить статусы обоих
    reg.status = 'main_list'
    reg.save()
    
    partner_reg = TournamentRegistration.objects.get(
        tournament=tournament,
        player=partner
    )
    partner_reg.status = 'main_list'
    partner_reg.partner = player
    partner_reg.save()
    
    # Создать TournamentEntry (через сигнал)
    recalculate_queue(tournament)
```

### Система очередей

```python
def recalculate_queue(tournament: Tournament):
    """
    Пересчитать очередь участников.
    
    Логика:
    1. Пары в основном списке (до planned_participants)
    2. Пары в резервном списке (после planned_participants)
    3. Одиночки, ищущие напарника
    """
    # Получить все пары
    pairs = TournamentRegistration.objects.filter(
        tournament=tournament,
        partner__isnull=False
    ).order_by('registered_at')
    
    # Разделить на основной и резервный списки
    planned = tournament.planned_participants
    
    for i, reg in enumerate(pairs):
        if i < planned:
            reg.status = 'main_list'
            reg.queue_position = i + 1
        else:
            reg.status = 'reserve_list'
            reg.queue_position = i + 1
        reg.save()
```

---

## Telegram Bot

### Модель TelegramUser

```python
class TelegramUser(models.Model):
    telegram_id = models.BigIntegerField(unique=True)
    username = models.CharField(max_length=100, null=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100, null=True)
    player = models.OneToOneField(Player, null=True, related_name='telegram_user')
    created_at = models.DateTimeField(auto_now_add=True)
```

### Команды бота

**Основные команды:**
```python
/start - Начало работы с ботом
/help - Справка по командам
/tournaments - Список турниров
/register - Регистрация на турнир
/profile - Мой профиль
/stats - Моя статистика
```

### Handlers

```python
from telegram import Update
from telegram.ext import CommandHandler, CallbackContext

async def start(update: Update, context: CallbackContext):
    """Обработчик команды /start"""
    user = update.effective_user
    
    # Создать или получить TelegramUser
    tg_user, created = TelegramUser.objects.get_or_create(
        telegram_id=user.id,
        defaults={
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name
        }
    )
    
    # Приветствие
    await update.message.reply_text(
        f"Привет, {user.first_name}! 👋\n\n"
        "Я бот SandMatch для управления турнирами по пляжному теннису.\n\n"
        "Используй /help для списка команд."
    )

async def tournaments(update: Update, context: CallbackContext):
    """Список турниров"""
    tournaments = Tournament.objects.filter(
        status__in=['created', 'active']
    ).order_by('date')
    
    if not tournaments:
        await update.message.reply_text("Нет активных турниров")
        return
    
    text = "📅 Активные турниры:\n\n"
    for t in tournaments:
        text += f"• {t.name} - {t.date.strftime('%d.%m.%Y')}\n"
        text += f"  Участников: {t.entries.count()}/{t.planned_participants}\n\n"
    
    await update.message.reply_text(text)
```

### Webhook

```python
from telegram import Bot

bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)

@csrf_exempt
def telegram_webhook(request):
    """Обработка webhook от Telegram"""
    if request.method == 'POST':
        update = Update.de_json(request.body, bot)
        # Обработать update
        dispatcher.process_update(update)
        return JsonResponse({'ok': True})
    
    return JsonResponse({'error': 'Invalid method'}, status=405)
```

---

## Telegram Mini-App

### Архитектура

**Frontend:** React приложение в `frontend/src/pages/MiniApp/`

**Компоненты:**
- `MiniAppHome.tsx` - главная страница
- `MiniAppTournaments.tsx` - список турниров
- `MiniAppTournamentDetail.tsx` - детали турнира
- `MiniAppProfile.tsx` - профиль игрока
- `RegistrationModal.tsx` - модальное окно регистрации
- `PartnerSearchModal.tsx` - поиск напарника

### Инициализация

```tsx
import { useEffect } from 'react';

const MiniAppLayout: React.FC = () => {
  useEffect(() => {
    // Инициализация Telegram WebApp
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    
    // Получить данные пользователя
    const initData = tg.initDataUnsafe;
    const user = initData.user;
    
    // Аутентификация через initData
    authenticateWithTelegram(tg.initData);
  }, []);
  
  return <Outlet />;
};
```

### Аутентификация

```python
def authenticate_telegram_user(init_data: str) -> User:
    """
    Аутентифицировать пользователя Telegram.
    
    Проверяет подпись initData и создает/получает User.
    """
    # Проверить подпись
    if not verify_telegram_signature(init_data):
        raise ValueError("Invalid signature")
    
    # Парсить данные
    data = parse_init_data(init_data)
    tg_user = data['user']
    
    # Получить или создать TelegramUser
    telegram_user, _ = TelegramUser.objects.get_or_create(
        telegram_id=tg_user['id'],
        defaults={
            'username': tg_user.get('username'),
            'first_name': tg_user['first_name'],
            'last_name': tg_user.get('last_name')
        }
    )
    
    # Получить или создать User
    if not telegram_user.player:
        # Создать Player и User
        user = User.objects.create(
            username=f"tg_{tg_user['id']}",
            first_name=tg_user['first_name'],
            last_name=tg_user.get('last_name', '')
        )
        
        player = Player.objects.create(
            user=user,
            first_name=tg_user['first_name'],
            last_name=tg_user.get('last_name', '')
        )
        
        telegram_user.player = player
        telegram_user.save()
    
    return telegram_user.player.user
```

---

## Уведомления

### Модель Notification

```python
class Notification(models.Model):
    class Type(models.TextChoices):
        TOURNAMENT_CREATED = 'tournament_created', 'Турнир создан'
        REGISTRATION_CONFIRMED = 'registration_confirmed', 'Регистрация подтверждена'
        PARTNER_INVITATION = 'partner_invitation', 'Приглашение в пару'
        MATCH_SCHEDULED = 'match_scheduled', 'Матч назначен'
        MATCH_STARTED = 'match_started', 'Матч начался'
        MATCH_COMPLETED = 'match_completed', 'Матч завершен'
    
    user = models.ForeignKey(User, related_name='notifications')
    type = models.CharField(choices=Type.choices)
    title = models.CharField(max_length=200)
    message = models.TextField()
    data = models.JSONField(null=True)  # Дополнительные данные
    is_read = models.BooleanField(default=False)
    sent_at = models.DateTimeField(auto_now_add=True)
```

### Celery задачи

```python
from celery import shared_task

@shared_task
def send_telegram_notification(user_id: int, message: str):
    """Отправить уведомление в Telegram"""
    user = User.objects.get(id=user_id)
    
    if not user.telegram_id:
        return
    
    bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    bot.send_message(
        chat_id=user.telegram_id,
        text=message,
        parse_mode='HTML'
    )

@shared_task
def notify_match_start(match_id: int):
    """Уведомить участников о начале матча"""
    match = Match.objects.get(id=match_id)
    
    # Получить игроков
    players = []
    if match.team_1:
        players.extend([match.team_1.player_1, match.team_1.player_2])
    if match.team_2:
        players.extend([match.team_2.player_1, match.team_2.player_2])
    
    # Отправить уведомления
    for player in players:
        if player and player.user:
            message = f"🎾 Ваш матч начинается!\n\n{match.team_1} vs {match.team_2}"
            send_telegram_notification.delay(player.user.id, message)
```

### Триггеры уведомлений

```python
@receiver(post_save, sender=Match)
def notify_on_match_status_change(sender, instance, **kwargs):
    """Отправить уведомление при изменении статуса матча"""
    if instance.status == 'live':
        notify_match_start.delay(instance.id)
    elif instance.status == 'completed':
        notify_match_completed.delay(instance.id)
```

---

## API Endpoints для Mini-App

### GET /api/miniapp/tournaments/

Список турниров для Mini-App.

```json
Response:
{
  "tournaments": [
    {
      "id": 1,
      "name": "Кубок города",
      "date": "2024-07-15",
      "participants_count": 12,
      "planned_participants": 16,
      "is_registered": false,
      "registration_status": null
    }
  ]
}
```

### POST /api/miniapp/tournaments/{id}/register/

Регистрация на турнир.

```json
Request:
{
  "type": "single"  // или "pair"
  "partner_id": 123  // если type="pair"
}

Response:
{
  "ok": true,
  "status": "looking_for_partner",
  "queue_position": null
}
```

### GET /api/miniapp/profile/

Профиль пользователя в Mini-App.

```json
Response:
{
  "player": {
    "id": 10,
    "name": "Иванов Иван",
    "rating": 3.5
  },
  "registrations": [
    {
      "tournament_name": "Кубок города",
      "status": "main_list",
      "partner": "Петров Петр"
    }
  ]
}
```

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024
