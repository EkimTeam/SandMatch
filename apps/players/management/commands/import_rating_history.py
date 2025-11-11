from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
import csv
from pathlib import Path
from datetime import datetime
from apps.players.models import Player, PlayerRatingHistory
from apps.tournaments.models import Tournament
from apps.matches.models import Match


class Command(BaseCommand):
    help = "Импортирует историю рейтинга игроков по матчам из CSV (player_rating_history.csv) в players_playerratinghistory"

    def add_arguments(self, parser):
        parser.add_argument(
            "csv_path",
            type=str,
            nargs="?",
            default=None,
            help="Путь к player_rating_history.csv (если не указан, ищется в calc_rayting/)"
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
                base_dir / "calc_rayting" / "player_rating_history.csv",
                Path("/app/calc_rayting/player_rating_history.csv"),  # В контейнере
                Path("/app/player_rating_history.csv"),  # В корне проекта в контейнере
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
                self.stdout.write("  docker cp calc_rayting/player_rating_history.csv $(docker-compose ps -q web):/app/calc_rayting/")
                self.stdout.write("  docker-compose exec web python manage.py import_rating_history")
                self.stdout.write("\nВариант 2: Указать путь к файлу")
                self.stdout.write("  docker-compose exec web python manage.py import_rating_history /app/calc_rayting/player_rating_history.csv")
                self.stdout.write("\nВариант 3: Через stdin (если файл на хосте)")
                self.stdout.write("  cat calc_rayting/player_rating_history.csv | docker-compose exec -T web python manage.py import_rating_history -")
                raise CommandError("Файл не найден. См. инструкции выше.")
            
        self.stdout.write(self.style.SUCCESS(f"Используется файл: {csv_path}"))

        created = 0
        updated = 0
        skipped = 0

        # Поддержка чтения из stdin (для docker cp через pipe)
        if str(csv_path) == "-":
            import sys
            import io
            # Читаем stdin как UTF-8
            # Важно: используем newline='' для правильной обработки CSV
            # Также пропускаем BOM, если он есть
            f = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8-sig', newline='')
        else:
            # Открываем файл с явным указанием UTF-8 и newline=''
            # utf-8-sig автоматически пропускает BOM, если он есть
            f = csv_path.open("r", encoding="utf-8-sig", newline='')
        
        try:
            # CSV reader автоматически обработает UTF-8, если файл открыт правильно
            reader = csv.DictReader(f)
            required = {"player_id", "value", "tournament_id", "match_id"}
            if not required.issubset(reader.fieldnames or []):
                raise CommandError(f"CSV должен содержать колонки: {', '.join(sorted(required))}")

            @transaction.atomic
            def do_import():
                nonlocal created, updated, skipped
                for row in reader:
                    try:
                        player_id = int(row["player_id"])
                        value = int(float(row["value"]))  # Округляем до целого
                        reason_raw = row.get("reason", "").strip()
                        # reason уже должен быть строкой UTF-8, т.к. файл открыт с encoding='utf-8'
                        # Но на всякий случай проверяем
                        if reason_raw:
                            reason = reason_raw
                        else:
                            reason = None
                        tournament_id = int(row["tournament_id"]) if row.get("tournament_id") else None
                        match_id = int(row["match_id"]) if row.get("match_id") else None
                        
                        # Парсим дату, если есть
                        created_at = None
                        if row.get("created_at"):
                            try:
                                created_at = datetime.strptime(row["created_at"], "%Y-%m-%d %H:%M:%S")
                            except:
                                try:
                                    created_at = datetime.strptime(row["created_at"], "%Y-%m-%d")
                                except:
                                    pass
                    except (ValueError, TypeError) as e:
                        skipped += 1
                        continue

                    try:
                        player = Player.objects.get(pk=player_id)
                    except Player.DoesNotExist:
                        skipped += 1
                        continue

                    tournament = None
                    if tournament_id:
                        try:
                            tournament = Tournament.objects.get(pk=tournament_id)
                        except Tournament.DoesNotExist:
                            pass

                    match = None
                    if match_id:
                        try:
                            match = Match.objects.get(pk=match_id)
                        except Match.DoesNotExist:
                            pass

                    if not options["dry_run"]:
                        # Создаем запись истории рейтинга
                        # Если есть created_at, используем его, иначе auto_now_add
                        if created_at:
                            obj = PlayerRatingHistory.objects.create(
                                player=player,
                                value=value,
                                reason=reason,
                                tournament=tournament,
                                match=match,
                            )
                            # Обновляем created_at вручную, если нужно
                            if created_at:
                                PlayerRatingHistory.objects.filter(pk=obj.pk).update(created_at=created_at)
                        else:
                            PlayerRatingHistory.objects.create(
                                player=player,
                                value=value,
                                reason=reason,
                                tournament=tournament,
                                match=match,
                            )
                    created += 1

            if options["dry_run"]:
                for _ in reader:
                    pass
                self.stdout.write(self.style.WARNING("Проверка CSV прошла. Ничего не записано (--dry-run)."))
                return

            do_import()
        finally:
            if str(csv_path) != "-" and hasattr(f, 'close'):
                f.close()

        self.stdout.write(self.style.SUCCESS(f"Импорт завершён. Создано: {created}, пропущено: {skipped}"))

