"""
Management команда для проверки доступных BTR-файлов на сайте.
"""
from django.core.management.base import BaseCommand

from apps.btr.services.downloader import fetch_available_files


class Command(BaseCommand):
    help = "Проверяет, какие BTR-файлы доступны для скачивания на сайте btrussia.com"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Показать только N последних файлов",
        )

    def handle(self, *args, **options):
        limit = options.get("limit")

        self.stdout.write(self.style.SUCCESS("Получение списка доступных файлов с btrussia.com..."))
        self.stdout.write("")

        try:
            files = fetch_available_files()

            if not files:
                self.stdout.write(self.style.WARNING("Файлы не найдены"))
                return

            # Сортируем по дате (новые первые)
            files.sort(key=lambda x: x[2], reverse=True)

            if limit:
                files = files[:limit]

            self.stdout.write(self.style.SUCCESS(f"Найдено {len(files)} файлов:\n"))

            for i, (file_url, filename, rating_date) in enumerate(files, 1):
                date_str = rating_date.strftime("%Y-%m-%d")
                self.stdout.write(f"{i:3}. [{date_str}] {filename}")
                self.stdout.write(f"     URL: {file_url}")
                self.stdout.write("")

            self.stdout.write(self.style.SUCCESS(f"\nВсего файлов: {len(files)}"))

        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Ошибка: {e}"))
            raise
