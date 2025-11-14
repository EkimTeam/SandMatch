from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.players.models import Player, PlayerRatingHistory, PlayerRatingDynamic
from apps.tournaments.models import Tournament


class Command(BaseCommand):
    help = (
        "Откатить и очистить рейтинг по турниру: "
        "- вычесть PlayerRatingDynamic.total_change из Player.current_rating для всех игроков турнира; "
        "- удалить записи из PlayerRatingHistory и PlayerRatingDynamic для этого турнира."
    )

    def add_arguments(self, parser):
        parser.add_argument('tournament_id', type=int, help='ID турнира для очистки рейтинга')
        parser.add_argument(
            '--dry-run', action='store_true', default=False,
            help='Только показать, что будет сделано, без изменений'
        )

    @transaction.atomic
    def handle(self, *args, **options):
        tournament_id: int = options['tournament_id']
        dry_run: bool = options['dry_run']

        try:
            t = Tournament.objects.get(id=tournament_id)
        except Tournament.DoesNotExist:
            raise CommandError(f"Турнир с id={tournament_id} не найден")

        dyn_qs = PlayerRatingDynamic.objects.filter(tournament_id=tournament_id)
        total_dyn = dyn_qs.count()
        if total_dyn == 0:
            self.stdout.write(self.style.WARNING("PlayerRatingDynamic: записей нет — откатывать нечего"))
        else:
            self.stdout.write(f"Найдено агрегатов PlayerRatingDynamic: {total_dyn}")

        # Соберём изменения по игрокам
        changes = list(dyn_qs.values('player_id', 'total_change'))
        affected_players = {row['player_id'] for row in changes}
        self.stdout.write(f"Игроков к откату: {len(affected_players)}")

        # Применим откат
        for row in changes:
            pid = row['player_id']
            delta = int(round(row['total_change'] or 0))
            if delta == 0:
                continue
            try:
                p = Player.objects.select_for_update().get(id=pid)
            except Player.DoesNotExist:
                continue
            before = int(p.current_rating or 0)
            after = before - delta
            if after < 0:
                after = 0
            if dry_run:
                self.stdout.write(f"DRY-RUN: Player {pid}: {before} -> {after} (delta -{delta})")
            else:
                p.current_rating = after
                p.save(update_fields=['current_rating'])

        # Удаление историй и агрегатов
        hist_qs = PlayerRatingHistory.objects.filter(tournament_id=tournament_id)
        total_hist = hist_qs.count()
        self.stdout.write(f"История к удалению: {total_hist}")

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY-RUN: удаление записей пропущено"))
        else:
            hist_qs.delete()
            dyn_qs.delete()
            self.stdout.write(self.style.SUCCESS("Готово: история и агрегаты удалены, рейтинги откатаны"))
