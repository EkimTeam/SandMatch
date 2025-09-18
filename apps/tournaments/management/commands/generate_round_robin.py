from django.core.management.base import BaseCommand, CommandError

from apps.tournaments.models import Tournament
from apps.tournaments.services.round_robin import (
    generate_round_robin_matches,
    persist_generated_matches,
)


class Command(BaseCommand):
    help = "Генерирует расписание (круговая система) для указанного турнира"

    def add_arguments(self, parser):
        parser.add_argument("tournament_id", type=int, help="ID турнира")

    def handle(self, *args, **options):
        tournament_id: int = options["tournament_id"]
        try:
            tournament = Tournament.objects.get(pk=tournament_id)
        except Tournament.DoesNotExist:
            raise CommandError(f"Турнир id={tournament_id} не найден")

        if tournament.system != Tournament.System.ROUND_ROBIN:
            raise CommandError("Турнир не в режиме круговой системы")

        generated = generate_round_robin_matches(tournament)
        created = persist_generated_matches(tournament, generated)
        self.stdout.write(self.style.SUCCESS(f"Создано матчей: {created}"))
