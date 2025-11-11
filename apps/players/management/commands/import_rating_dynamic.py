from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
import csv
from pathlib import Path
import os
from apps.players.models import Player, PlayerRatingDynamic
from apps.tournaments.models import Tournament
from django.utils import timezone


class Command(BaseCommand):
    help = "Импортирует динамику рейтинга игроков по турнирам из CSV (rating_history_by_tournament.csv)"

    def add_arguments(self, parser):
        parser.add_argument(
            "csv_path",
            type=str,
            nargs="?",
            default=None,
            help="Путь к rating_history_by_tournament.csv (если не указан, ищется в calc_rayting/)"
        )
        parser.add_argument("--dry-run", action="store_true", help="Только проверить, без записи")

    def handle(self, *args, **options):
        csv_path_str = options["csv_path"]
        
        if csv_path_str:
            csv_path = Path(csv_path_str) if csv_path_str != "-" else Path("-")
        else:
            # Ищем в нескольких стандартных местах
            base_dir = Path(__file__).resolve().parent.parent.parent.parent.parent
            possible_paths = [
                base_dir / "calc_rayting" / "rating_history_by_tournament.csv",
                Path("/app/calc_rayting/rating_history_by_tournament.csv"),  # В контейнере
                Path("/app/rating_history_by_tournament.csv"),  # В корне проекта в контейнере
            ]
            
            csv_path = None
            for path in possible_paths:
                if path.exists():
                    csv_path = path
                    break
            
            if not csv_path:
                self.stdout.write(self.style.ERROR("Файл не найден в стандартных местах."))
                self.stdout.write(self.style.WARNING("\nИнструкция для Docker:"))
                self.stdout.write("Вариант 1: Скопировать файл в контейнер")
                self.stdout.write("  docker cp calc_rayting/rating_history_by_tournament.csv $(docker-compose ps -q web):/app/calc_rayting/")
                self.stdout.write("  docker-compose exec web python manage.py import_rating_dynamic")
                self.stdout.write("\nВариант 2: Указать путь к файлу")
                self.stdout.write("  docker-compose exec web python manage.py import_rating_dynamic /app/calc_rayting/rating_history_by_tournament.csv")
                self.stdout.write("\nВариант 3: Через stdin (если файл на хосте)")
                self.stdout.write("  cat calc_rayting/rating_history_by_tournament.csv | docker-compose exec -T web python manage.py import_rating_dynamic -")
                raise CommandError("Файл не найден. См. инструкции выше.")
            
        self.stdout.write(self.style.SUCCESS(f"Используется файл: {csv_path}"))

        created = 0
        updated = 0
        skipped = 0

        # Поддержка чтения из stdin (для docker cp через pipe)
        if str(csv_path) == "-":
            import sys
            f = sys.stdin
        else:
            f = csv_path.open("r", encoding="utf-8")
        
        try:
            reader = csv.DictReader(f)
            required = {"player_id", "tournament_id", "rating_before", "rating_after", "total_change", "matches_count"}
            if not required.issubset(reader.fieldnames or []):
                raise CommandError(f"CSV должен содержать колонки: {', '.join(sorted(required))}")

            @transaction.atomic
            def do_import():
                nonlocal created, updated, skipped
                for row in reader:
                    try:
                        player_id = int(row["player_id"])
                        tournament_id = int(row["tournament_id"])
                        rating_before = int(float(row["rating_before"]))
                        rating_after = int(float(row["rating_after"]))
                        total_change = int(float(row["total_change"]))
                        matches_count = int(float(row.get("matches_count") or 0))
                    except Exception:
                        skipped += 1
                        continue

                    try:
                        player = Player.objects.get(pk=player_id)
                        tournament = Tournament.objects.get(pk=tournament_id)
                    except (Player.DoesNotExist, Tournament.DoesNotExist):
                        skipped += 1
                        continue

                    obj, is_created = PlayerRatingDynamic.objects.update_or_create(
                        player=player,
                        tournament=tournament,
                        defaults={
                            "rating_before": rating_before,
                            "rating_after": rating_after,
                            "total_change": total_change,
                            "matches_count": matches_count,
                            "calculated_at": timezone.now(),
                        },
                    )
                    if is_created:
                        created += 1
                    else:
                        updated += 1

            if options["dry_run"]:
                for _ in reader:
                    pass
                self.stdout.write(self.style.WARNING("Проверка CSV прошла. Ничего не записано (--dry-run)."))
                return

            do_import()
        finally:
            if str(csv_path) != "-" and hasattr(f, 'close'):
                f.close()

        self.stdout.write(self.style.SUCCESS(f"Импорт завершён. Создано: {created}, обновлено: {updated}, пропущено: {skipped}"))


