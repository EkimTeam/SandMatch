"""
Management команда для импорта BTR-файлов из локальной директории.
"""
import logging
import re
from datetime import datetime
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.btr.models import BtrPlayer, BtrRatingSnapshot, BtrSourceFile
from apps.btr.services.parser import parse_btr_file

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Импортирует BTR-файлы из указанной директории"

    def add_arguments(self, parser):
        parser.add_argument(
            "directory",
            type=str,
            help="Путь к директории с BTR-файлами (Excel)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет импортировано, без сохранения в БД",
        )

    def handle(self, *args, **options):
        directory = Path(options["directory"])
        dry_run = options.get("dry_run", False)

        if not directory.exists() or not directory.is_dir():
            self.stderr.write(self.style.ERROR(f"Директория не найдена: {directory}"))
            return

        # Ищем все Excel-файлы
        excel_files = list(directory.glob("*.xlsx")) + list(directory.glob("*.xls"))
        if not excel_files:
            self.stdout.write(self.style.WARNING(f"В директории {directory} не найдено Excel-файлов"))
            return

        # Сортируем файлы по дате (от старых к новым), чтобы новые данные перезаписывали старые
        files_with_dates = []
        for file_path in excel_files:
            rating_date = self._extract_date_from_filename(file_path.name)
            if rating_date:
                files_with_dates.append((file_path, rating_date))
            else:
                self.stderr.write(
                    self.style.WARNING(f"Не удалось извлечь дату из имени файла: {file_path.name}. Пропускаем.")
                )
        
        # Сортируем по дате (старые первые, новые последние)
        files_with_dates.sort(key=lambda x: x[1])
        
        self.stdout.write(self.style.SUCCESS(f"Найдено {len(files_with_dates)} файлов для обработки"))
        self.stdout.write(f"Период: {files_with_dates[0][1].strftime('%Y-%m-%d')} - {files_with_dates[-1][1].strftime('%Y-%m-%d')}\n")

        for file_path, rating_date in files_with_dates:
            self.stdout.write(f"\n{'='*80}")
            self.stdout.write(f"Обработка файла: {file_path.name}")
            self.stdout.write(f"{'='*80}")
            self.stdout.write(f"Дата рейтинга: {rating_date.strftime('%Y-%m-%d')}")

            try:
                # Парсим файл
                players_data = parse_btr_file(str(file_path), rating_date)

                if not players_data:
                    self.stdout.write(self.style.WARNING("Не найдено данных игроков в файле"))
                    continue

                # Группируем по категориям для статистики
                by_category = {}
                for player in players_data:
                    if player.category not in by_category:
                        by_category[player.category] = []
                    by_category[player.category].append(player)

                self.stdout.write(f"\nНайдено записей по категориям:")
                for category, players in by_category.items():
                    self.stdout.write(f"  - {category}: {len(players)} игроков")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n[DRY RUN] Данные не сохранены в БД"))
                    # Показываем примеры
                    self.stdout.write("\nПримеры данных:")
                    for i, player in enumerate(players_data[:5]):
                        self.stdout.write(
                            f"  {i+1}. {player.last_name} {player.first_name} {player.middle_name} "
                            f"(РНИ: {player.rni}, {player.category}): {player.rating_value} очков"
                        )
                else:
                    # Сохраняем в БД
                    self._import_to_database(file_path, rating_date, players_data)
                    self.stdout.write(self.style.SUCCESS(f"\n✓ Файл {file_path.name} успешно импортирован"))

            except Exception as e:
                self.stderr.write(self.style.ERROR(f"Ошибка при обработке файла {file_path.name}: {e}"))
                logger.exception(f"Ошибка при обработке файла {file_path}")
                continue

        self.stdout.write(f"\n{'='*80}")
        self.stdout.write(self.style.SUCCESS("Импорт завершён"))

    def _extract_date_from_filename(self, filename: str) -> datetime | None:
        """
        Извлекает дату из имени файла.
        Ожидаемые форматы: YYYY-MM-DD, DD.MM.YYYY, YYYYMMDD и т.д.
        """
        # Попробуем различные паттерны
        patterns = [
            r"(\d{4})-(\d{2})-(\d{2})",  # YYYY-MM-DD
            r"(\d{2})\.(\d{2})\.(\d{4})",  # DD.MM.YYYY
            r"(\d{4})(\d{2})(\d{2})",  # YYYYMMDD
            r"(\d{2})_(\d{2})_(\d{4})",  # DD_MM_YYYY
        ]

        for pattern in patterns:
            match = re.search(pattern, filename)
            if match:
                groups = match.groups()
                try:
                    if len(groups[0]) == 4:  # YYYY first
                        year, month, day = int(groups[0]), int(groups[1]), int(groups[2])
                    else:  # DD first
                        day, month, year = int(groups[0]), int(groups[1]), int(groups[2])
                    return datetime(year, month, day)
                except ValueError:
                    continue

        return None

    @transaction.atomic
    def _import_to_database(self, file_path: Path, rating_date: datetime, players_data: list):
        """Импортирует данные в базу данных."""
        # Создаём запись о файле-источнике
        source_file, created = BtrSourceFile.objects.get_or_create(
            filename=file_path.name,
            defaults={
                "url": f"file://{file_path}",
                "applied_at": datetime.now(),
            },
        )

        if not created:
            self.stdout.write(self.style.WARNING(f"Файл {file_path.name} уже был импортирован ранее"))
            # Можно решить, перезаписывать данные или нет
            # Пока пропускаем
            return

        # Обрабатываем каждого игрока
        players_created = 0
        players_updated = 0
        snapshots_created = 0

        for player_data in players_data:
            # Ищем или создаём игрока по РНИ
            player, created = BtrPlayer.objects.get_or_create(
                rni=player_data.rni,
                defaults={
                    "external_id": player_data.rni,  # Используем РНИ как external_id
                    "last_name": player_data.last_name,
                    "first_name": player_data.first_name,
                    "middle_name": player_data.middle_name,
                    "gender": player_data.gender,  # Автоматически определённый пол
                    "birth_date": player_data.birth_date,
                    "city": player_data.city,
                    "country": "RU",  # По умолчанию Россия
                },
            )

            if created:
                players_created += 1
            else:
                # Всегда обновляем данные игрока из нового файла
                # Данные могут меняться: фамилия, имя, отчество, город, дата рождения
                # Также могут заполняться пустые поля
                updated = False
                
                # Обновляем ФИО (всегда, так как может измениться)
                if player.last_name != player_data.last_name:
                    player.last_name = player_data.last_name
                    updated = True
                if player.first_name != player_data.first_name:
                    player.first_name = player_data.first_name
                    updated = True
                
                # Обновляем отчество (всегда, даже если было пустым)
                if player.middle_name != player_data.middle_name:
                    player.middle_name = player_data.middle_name
                    updated = True
                
                # Обновляем пол (если не был установлен или изменился)
                if player.gender != player_data.gender:
                    player.gender = player_data.gender
                    updated = True
                
                # Обновляем дату рождения (если есть новые данные или была пустой)
                if player_data.birth_date and player.birth_date != player_data.birth_date:
                    player.birth_date = player_data.birth_date
                    updated = True
                
                # Обновляем город (всегда, даже если был пустым)
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

        self.stdout.write(f"\nСтатистика импорта:")
        self.stdout.write(f"  - Создано игроков: {players_created}")
        self.stdout.write(f"  - Обновлено игроков: {players_updated}")
        self.stdout.write(f"  - Создано снимков рейтинга: {snapshots_created}")
