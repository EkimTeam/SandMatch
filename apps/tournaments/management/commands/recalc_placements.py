from datetime import datetime

from django.core.management.base import BaseCommand, CommandError

from apps.tournaments.models import Tournament
from apps.tournaments.services.placements import recalc_tournament_placements


class Command(BaseCommand):
    help = (
        "Пересчёт мест (TournamentPlacement) для турниров. "
        "По умолчанию — для одного турнира по ID, "
        "либо для всех/всех до даты при использовании флагов."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "tournament_id",
            type=int,
            nargs="?",
            help="ID турнира (опционально, если используются --all или --before)",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            dest="all",
            help="Пересчитать места для всех завершённых турниров",
        )
        parser.add_argument(
            "--before",
            type=str,
            dest="before",
            help=(
                "Пересчитать места для завершённых турниров с датой "
                "<= указанной (формат YYYY-MM-DD)"
            ),
        )

    def handle(self, *args, **options):
        tid = options.get("tournament_id")
        all_flag = options.get("all")
        before = options.get("before")

        if tid is None and not all_flag and not before:
            raise CommandError(
                "Нужно указать либо ID турнира, либо параметр --all, либо --before YYYY-MM-DD"
            )

        if tid is not None and (all_flag or before):
            raise CommandError(
                "Нельзя одновременно указывать ID турнира и параметры --all/--before"
            )

        # Режим одного турнира — сохраняем исходное поведение
        if tid is not None:
            try:
                tournament = Tournament.objects.get(pk=tid)
            except Tournament.DoesNotExist:
                raise CommandError(f"Tournament id={tid} not found")

            created = recalc_tournament_placements(tournament)
            self.stdout.write(
                self.style.SUCCESS(
                    f"Recalculated placements for tournament #{tid}, created {created} records"
                )
            )
            return

        # Массовый режим: все или до даты
        qs = Tournament.objects.filter(status=Tournament.Status.COMPLETED)

        if before:
            try:
                before_date = datetime.strptime(before, "%Y-%m-%d").date()
            except ValueError as e:
                raise CommandError(f"Некорректная дата в --before: {before!r} ({e})")

            qs = qs.filter(date__lte=before_date)

        count = qs.count()
        if count == 0:
            self.stdout.write(self.style.WARNING("Подходящих турниров не найдено"))
            return

        self.stdout.write(
            f"Пересчитываем места для {count} турниров (status=completed"
            + (f", date <= {before}" if before else "")
            + ")"
        )

        total_created = 0
        for tournament in qs.order_by("id"):
            created = recalc_tournament_placements(tournament)
            total_created += created
            self.stdout.write(
                self.style.SUCCESS(
                    f"  Tournament #{tournament.id}: created {created} placement records"
                )
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Готово. Обработано турниров: {count}, всего создано записей мест: {total_created}"
            )
        )
