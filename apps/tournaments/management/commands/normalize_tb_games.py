from django.core.management.base import BaseCommand
from django.db import transaction

from apps.matches.models import MatchSet
from apps.tournaments.models import Tournament


class Command(BaseCommand):
    help = (
        "Normalize TB-only set games: store 1:0/0:1 for champion tiebreak sets, "
        "except for tournaments with 'only tiebreak' format (max_sets=1 and allow_tiebreak_only_set=True), "
        "where games should store actual TB points."
    )

    def add_arguments(self, parser):
        parser.add_argument('--tournament', type=int, help='Limit to a specific tournament ID')
        parser.add_argument('--dry-run', action='store_true', help='Do not write changes, only show summary')

    @transaction.atomic
    def handle(self, *args, **options):
        tournament_id = options.get('tournament')
        dry_run = options.get('dry_run', False)

        qs = MatchSet.objects.filter(is_tiebreak_only=True).select_related('match__tournament')
        if tournament_id:
            qs = qs.filter(match__tournament_id=tournament_id)

        updated = 0
        skipped = 0

        for s in qs.iterator():
            t: Tournament = s.match.tournament
            sf = getattr(t, 'set_format', None)
            only_tb = False
            if sf is not None:
                try:
                    only_tb = bool(getattr(sf, 'allow_tiebreak_only_set', False)) and int(getattr(sf, 'max_sets', 1)) == 1
                except Exception:
                    only_tb = False

            # Determine desired games values
            if only_tb:
                desired_g1 = int(s.tb_1 or 0)
                desired_g2 = int(s.tb_2 or 0)
            else:
                # champion TB as 1:0/0:1 based on TB winner
                if int(s.tb_1 or 0) > int(s.tb_2 or 0):
                    desired_g1, desired_g2 = 1, 0
                else:
                    desired_g1, desired_g2 = 0, 1

            if s.games_1 == desired_g1 and s.games_2 == desired_g2:
                skipped += 1
                continue

            if dry_run:
                self.stdout.write(f"Would update MatchSet id={s.id}: games {s.games_1}:{s.games_2} -> {desired_g1}:{desired_g2}")
                updated += 1
            else:
                s.games_1 = desired_g1
                s.games_2 = desired_g2
                s.save(update_fields=['games_1', 'games_2'])
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f"Processed TB-only sets: updated={updated}, unchanged={skipped}, dry_run={dry_run}"
        ))
