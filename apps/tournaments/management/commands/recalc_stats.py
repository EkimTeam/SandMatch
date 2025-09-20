from django.core.management.base import BaseCommand, CommandError

from apps.tournaments.models import Tournament
from apps.tournaments.services.stats import recalc_tournament_stats


class Command(BaseCommand):
    help = "Пересчёт денормализованной статистики (wins/sets/games) по всем группам турнира"

    def add_arguments(self, parser):
        parser.add_argument("tournament_id", type=int, help="ID турнира")

    def handle(self, *args, **options):
        tid = options["tournament_id"]
        try:
            tournament = Tournament.objects.get(pk=tid)
        except Tournament.DoesNotExist:
            raise CommandError(f"Tournament id={tid} not found")

        updated = recalc_tournament_stats(tournament)
        self.stdout.write(self.style.SUCCESS(f"Updated stats for {updated} entries in tournament #{tid}"))
