"""
Management команда для очистки всех данных BTR из базы данных.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.btr.models import BtrPlayer, BtrRatingSnapshot, BtrSourceFile


class Command(BaseCommand):
    help = "Очищает все данные BTR из базы данных"

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm",
            action="store_true",
            help="Подтвердить удаление без дополнительного запроса",
        )

    def handle(self, *args, **options):
        confirm = options.get("confirm", False)

        # Получаем статистику перед удалением
        players_count = BtrPlayer.objects.count()
        snapshots_count = BtrRatingSnapshot.objects.count()
        files_count = BtrSourceFile.objects.count()

        self.stdout.write(self.style.WARNING("\n" + "=" * 80))
        self.stdout.write(self.style.WARNING("ВНИМАНИЕ! Будут удалены следующие данные:"))
        self.stdout.write(self.style.WARNING("=" * 80))
        self.stdout.write(f"  - Игроков BTR: {players_count}")
        self.stdout.write(f"  - Снимков рейтинга: {snapshots_count}")
        self.stdout.write(f"  - Файлов-источников: {files_count}")
        self.stdout.write(self.style.WARNING("=" * 80 + "\n"))

        if players_count == 0 and snapshots_count == 0 and files_count == 0:
            self.stdout.write(self.style.SUCCESS("База данных BTR уже пуста"))
            return

        # Запрашиваем подтверждение
        if not confirm:
            response = input("Вы уверены, что хотите удалить все данные BTR? (yes/no): ")
            if response.lower() != "yes":
                self.stdout.write(self.style.WARNING("Операция отменена"))
                return

        # Удаляем данные
        self.stdout.write("Удаление данных...")

        with transaction.atomic():
            # Удаляем в правильном порядке (сначала зависимые данные)
            deleted_snapshots = BtrRatingSnapshot.objects.all().delete()[0]
            deleted_players = BtrPlayer.objects.all().delete()[0]
            deleted_files = BtrSourceFile.objects.all().delete()[0]

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("✓ Данные успешно удалены:"))
        self.stdout.write(f"  - Снимков рейтинга: {deleted_snapshots}")
        self.stdout.write(f"  - Игроков BTR: {deleted_players}")
        self.stdout.write(f"  - Файлов-источников: {deleted_files}")
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("База данных BTR очищена"))
