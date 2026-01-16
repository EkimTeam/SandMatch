from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.models import User

from apps.accounts.models import UserProfile, PDNActionLog
from apps.players.models import Player
from apps.telegram_bot.models import TelegramUser, TournamentSubscription, PairRequest, NotificationLog, LinkCode


class Command(BaseCommand):
    help = "Анонимизировать пользователя и связанные с ним персональные данные по user_id"

    def add_arguments(self, parser):
        parser.add_argument("user_id", type=int, help="ID пользователя, которого нужно анонимизировать")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать, что будет сделано, без внесения изменений",
        )

    def handle(self, *args, **options):
        user_id = options["user_id"]
        dry_run = options["dry_run"]

        try:
            user = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            raise CommandError(f"Пользователь с id={user_id} не найден")

        self.stdout.write(self.style.WARNING(f"Начинаю анонимизацию пользователя id={user.id}, username={user.username}"))

        # Собираем связанные объекты
        profile = getattr(user, "profile", None)
        telegram_user = getattr(user, "telegram_profile", None)
        created_players = Player.objects.filter(created_by=user)

        if dry_run:
            self.stdout.write("[DRY RUN] Будут изменены следующие объекты:")
            self.stdout.write(f"  - User id={user.id}, username={user.username}")
            if profile:
                self.stdout.write(f"  - UserProfile id={profile.id}, role={profile.role}")
            if telegram_user:
                self.stdout.write(f"  - TelegramUser id={telegram_user.id}, telegram_id={telegram_user.telegram_id}")
            if created_players.exists():
                self.stdout.write(f"  - Players, созданные пользователем: {created_players.count()} шт.")
            self.stdout.write("Команда запущена с --dry-run, изменений не производится.")
            return

        # 1. Анонимизация User
        anonymized_username = f"anon_{user.id}"
        user.username = anonymized_username
        user.first_name = ""
        user.last_name = ""
        user.email = ""
        # Сбрасывать пароль не обязательно, но можно установить неиспользуемый
        user.set_unusable_password()
        user.save(update_fields=["username", "first_name", "last_name", "email", "password"])

        # 2. Анонимизация UserProfile
        if profile:
            profile.telegram_id = None
            profile.telegram_username = ""
            # Оставляем роль и player-связь, чтобы не ломать внутреннюю логику,
            # но при необходимости это поведение можно скорректировать в будущем.
            profile.save(update_fields=["telegram_id", "telegram_username"])

        # 3. Анонимизация TelegramUser и связанных сущностей
        if telegram_user:
            telegram_user.telegram_id = None
            telegram_user.username = None
            telegram_user.first_name = ""
            telegram_user.last_name = ""
            telegram_user.is_blocked = False
            telegram_user.save(update_fields=["telegram_id", "username", "first_name", "last_name", "is_blocked"])

            # Удаляем временные коды связывания и логи уведомлений, так как это чисто технические данные
            LinkCode.objects.filter(user=user).delete()
            NotificationLog.objects.filter(telegram_user=telegram_user).delete()
            TournamentSubscription.objects.filter(telegram_user=telegram_user).delete()
            PairRequest.objects.filter(from_user=telegram_user).delete()
            PairRequest.objects.filter(to_user=telegram_user).delete()

        # 4. Анонимизация игроков, созданных пользователем
        for player in created_players:
            player.last_name = "Анонимный"
            player.first_name = "Игрок"
            player.patronymic = None
            player.phone = None
            # display_name оставляем как есть или приводим к обезличенному виду
            if not player.display_name:
                player.display_name = "Анонимный игрок"
            player.save(update_fields=["last_name", "first_name", "patronymic", "phone", "display_name"])

        # Фиксируем факт анонимизации в журнале ПДн
        PDNActionLog.objects.create(
            user=user,
            action=PDNActionLog.ACTION_ANONYMIZE,
            meta={"source": "management_command", "command": "anonymize_user"},
        )

        self.stdout.write(self.style.SUCCESS(f"Анонимизация пользователя id={user.id} выполнена."))
