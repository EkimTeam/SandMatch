"""
Management команда для скачивания и импорта новых BTR-файлов с сайта btrussia.com.
Предназначена для запуска по расписанию (cron).
"""
import logging
import tempfile
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.btr.models import BtrPlayer, BtrRatingSnapshot, BtrSourceFile
from apps.btr.services.downloader import fetch_available_files, download_file
from apps.btr.services.parser import parse_btr_file

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Скачивает и импортирует новые BTR-файлы с сайта btrussia.com"

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Максимальное количество файлов для скачивания (по умолчанию: все новые)",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Принудительно скачать и импортировать все файлы, даже если они уже были обработаны",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, какие файлы будут скачаны, без реального скачивания",
        )

    def handle(self, *args, **options):
        limit = options.get("limit")
        force = options.get("force", False)
        dry_run = options.get("dry_run", False)

        self.stdout.write(self.style.SUCCESS("=" * 80))
        self.stdout.write(self.style.SUCCESS("Скачивание и импорт BTR-рейтингов"))
        self.stdout.write(self.style.SUCCESS("=" * 80))
        self.stdout.write("")

        try:
            # Получаем список доступных файлов
            self.stdout.write("Получение списка доступных файлов с btrussia.com...")
            available_files = fetch_available_files()

            if not available_files:
                self.stdout.write(self.style.WARNING("Файлы не найдены на сайте"))
                return

            # Сортируем по дате (старые первые)
            available_files.sort(key=lambda x: x[2], reverse=False)

            self.stdout.write(self.style.SUCCESS(f"Найдено {len(available_files)} файлов на сайте\n"))

            # Получаем список уже обработанных файлов
            if not force:
                processed_filenames = set(BtrSourceFile.objects.values_list("filename", flat=True))
                self.stdout.write(f"Уже обработано файлов: {len(processed_filenames)}")
            else:
                processed_filenames = set()
                self.stdout.write("Режим --force: все файлы будут обработаны заново")

            # Фильтруем новые файлы
            new_files = [
                (url, filename, date)
                for url, filename, date in available_files
                if filename not in processed_filenames
            ]

            if not new_files:
                self.stdout.write(self.style.SUCCESS("\n✓ Все файлы уже обработаны. Новых файлов нет."))
                return

            if limit:
                new_files = new_files[:limit]

            self.stdout.write(self.style.SUCCESS(f"\nНайдено {len(new_files)} новых файлов для обработки:"))
            for i, (url, filename, date) in enumerate(new_files, 1):
                self.stdout.write(f"  {i}. [{date.strftime('%Y-%m-%d')}] {filename}")

            if dry_run:
                self.stdout.write(self.style.WARNING("\n[DRY RUN] Файлы не будут скачаны"))
                return

            self.stdout.write("")

            # Создаём временную директорию для скачанных файлов
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                
                total_processed = 0
                total_players_created = 0
                total_players_updated = 0
                total_snapshots_created = 0

                for i, (file_url, filename, rating_date) in enumerate(new_files, 1):
                    self.stdout.write(f"\n{'='*80}")
                    self.stdout.write(f"[{i}/{len(new_files)}] Обработка: {filename}")
                    self.stdout.write(f"{'='*80}")
                    self.stdout.write(f"Дата рейтинга: {rating_date.strftime('%Y-%m-%d')}")
                    self.stdout.write(f"URL: {file_url}")

                    # Скачиваем файл
                    destination = temp_path / filename
                    self.stdout.write(f"Скачивание...")
                    
                    if not download_file(file_url, destination):
                        self.stderr.write(self.style.ERROR(f"✗ Не удалось скачать файл"))
                        continue

                    # Парсим файл
                    try:
                        self.stdout.write(f"Парсинг файла...")
                        players_data = parse_btr_file(str(destination), rating_date)

                        if not players_data:
                            self.stdout.write(self.style.WARNING("Не найдено данных игроков в файле"))
                            continue

                        # Импортируем в БД
                        stats = self._import_to_database(file_url, filename, rating_date, players_data)
                        
                        total_processed += 1
                        total_players_created += stats["players_created"]
                        total_players_updated += stats["players_updated"]
                        total_snapshots_created += stats["snapshots_created"]

                        self.stdout.write(self.style.SUCCESS(f"✓ Файл успешно обработан"))
                        self.stdout.write(f"  - Создано игроков: {stats['players_created']}")
                        self.stdout.write(f"  - Обновлено игроков: {stats['players_updated']}")
                        self.stdout.write(f"  - Создано снимков: {stats['snapshots_created']}")

                    except Exception as e:
                        self.stderr.write(self.style.ERROR(f"✗ Ошибка при обработке файла: {e}"))
                        logger.exception(f"Ошибка при обработке файла {filename}")
                        continue

            # Итоговая статистика
            self.stdout.write(f"\n{'='*80}")
            self.stdout.write(self.style.SUCCESS("ИТОГОВАЯ СТАТИСТИКА"))
            self.stdout.write(f"{'='*80}")
            self.stdout.write(f"Обработано файлов: {total_processed}/{len(new_files)}")
            self.stdout.write(f"Создано игроков: {total_players_created}")
            self.stdout.write(f"Обновлено игроков: {total_players_updated}")
            self.stdout.write(f"Создано снимков рейтинга: {total_snapshots_created}")
            self.stdout.write(f"{'='*80}")
            self.stdout.write(self.style.SUCCESS("\n✓ Импорт завершён"))

        except Exception as e:
            self.stderr.write(self.style.ERROR(f"\n✗ Критическая ошибка: {e}"))
            logger.exception("Критическая ошибка при импорте BTR-рейтингов")
            raise

    @transaction.atomic
    def _import_to_database(self, file_url: str, filename: str, rating_date: datetime, players_data: list) -> dict:
        """Импортирует данные в базу данных."""
        # Создаём запись о файле-источнике
        source_file, created = BtrSourceFile.objects.get_or_create(
            filename=filename,
            defaults={
                "url": file_url,
                "applied_at": datetime.now(),
            },
        )

        if not created:
            # Файл уже был обработан, обновляем дату применения
            source_file.applied_at = datetime.now()
            source_file.save()

        # Обрабатываем каждого игрока
        players_created = 0
        players_updated = 0
        snapshots_created = 0

        for player_data in players_data:
            # Ищем или создаём игрока по РНИ
            player, created = BtrPlayer.objects.get_or_create(
                rni=player_data.rni,
                defaults={
                    "external_id": player_data.rni,
                    "last_name": player_data.last_name,
                    "first_name": player_data.first_name,
                    "middle_name": player_data.middle_name,
                    "gender": player_data.gender,
                    "birth_date": player_data.birth_date,
                    "city": player_data.city,
                    "country": "RU",
                },
            )

            if created:
                players_created += 1
            else:
                # Всегда обновляем данные игрока из нового файла
                updated = False
                
                if player.last_name != player_data.last_name:
                    player.last_name = player_data.last_name
                    updated = True
                if player.first_name != player_data.first_name:
                    player.first_name = player_data.first_name
                    updated = True
                if player.middle_name != player_data.middle_name:
                    player.middle_name = player_data.middle_name
                    updated = True
                if player.gender != player_data.gender:
                    player.gender = player_data.gender
                    updated = True
                if player_data.birth_date and player.birth_date != player_data.birth_date:
                    player.birth_date = player_data.birth_date
                    updated = True
                if player.city != player_data.city:
                    player.city = player_data.city
                    updated = True

                if updated:
                    player.save()
                    players_updated += 1

            # Создаём снимок рейтинга
            snapshot, created = BtrRatingSnapshot.objects.get_or_create(
                player=player,
                category=player_data.category,
                rating_date=rating_date.date(),
                defaults={
                    "rating_value": int(player_data.rating_value),
                    "rank": player_data.rank,
                    "tournaments_total": player_data.tournaments_total,
                    "tournaments_52_weeks": player_data.tournaments_52_weeks,
                    "tournaments_counted": player_data.tournaments_counted,
                },
            )

            if created:
                snapshots_created += 1

        return {
            "players_created": players_created,
            "players_updated": players_updated,
            "snapshots_created": snapshots_created,
        }
