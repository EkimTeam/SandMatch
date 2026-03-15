from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.tournaments.models import Tournament
from apps.tournaments.services.multi_stage_service import MultiStageService


class Command(BaseCommand):
    help = (
        "Завершить мастер-турнир (multi-stage) с пересчётом рейтинга по стадиям. "
        "Аналог действия UI 'Завершить мастер', но как management command."
    )

    def add_arguments(self, parser):
        parser.add_argument("master_tournament_id", type=int, help="ID головного турнира")
        parser.add_argument(
            "--force",
            action="store_true",
            help="Завершить даже если есть незавершённые матчи (force=True)",
        )

    def handle(self, *args, **options):
        master_id: int = int(options["master_tournament_id"])
        force: bool = bool(options.get("force"))

        try:
            t = Tournament.objects.get(id=master_id)
        except Tournament.DoesNotExist:
            raise CommandError(f"Турнир id={master_id} не найден")

        if not t.is_master():
            raise CommandError("tournament_complete_master ожидает ID мастер-турнира")

        MultiStageService.complete_master_tournament(master_tournament_id=master_id, force=force)
        self.stdout.write(self.style.SUCCESS("Готово: мастер-турнир завершён"))
