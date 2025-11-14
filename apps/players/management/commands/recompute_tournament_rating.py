from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.players.models import Player
from apps.players.services import rating_service
from apps.tournaments.models import Tournament
from apps.matches.models import Match


class Command(BaseCommand):
    help = (
        "Повторно пересчитать рейтинг по одному турниру. "
        "По умолчанию просто запускает расчёт по завершённым матчам турнира. "
        "С опцией --set-start применяет стартовые рейтинги (HARD=1100, MEDIUM=900, иначе 1000) для игроков с current_rating=0, участвовавших в турнире."
    )

    def add_arguments(self, parser):
        parser.add_argument('tournament_id', type=int, help='ID турнира для пересчёта')
        parser.add_argument(
            '--set-start', action='store_true', default=False,
            help='Перед пересчётом установить стартовые рейтинги игрокам с current_rating=0 по методике HARD/MEDIUM/DEFAULT'
        )

    @transaction.atomic
    def handle(self, *args, **options):
        tournament_id: int = options['tournament_id']
        set_start: bool = options['set_start']

        try:
            t = Tournament.objects.get(id=tournament_id)
        except Tournament.DoesNotExist:
            raise CommandError(f"Турнир с id={tournament_id} не найден")

        if set_start:
            # Определим стартовый рейтинг из названия турнира
            name_lc = (t.name or '').lower()
            if 'hard' in name_lc:
                start_rating = 1100
            elif 'medium' in name_lc:
                start_rating = 900
            else:
                start_rating = 1000

            # Игроки, участвовавшие в завершённых матчах турнира
            matches = (
                Match.objects
                .filter(tournament_id=t.id, status=Match.Status.COMPLETED)
                .select_related('team_1', 'team_2')
            )
            player_ids: set[int] = set()
            for m in matches:
                for pid in [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None),
                            getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)]:
                    if pid:
                        player_ids.add(pid)
            if player_ids:
                Player.objects.filter(id__in=player_ids, current_rating=0).update(current_rating=start_rating)
                self.stdout.write(self.style.NOTICE(
                    f"Стартовые рейтинги назначены ({start_rating}) игрокам с current_rating=0: {len(player_ids)} шт."
                ))

        # Запускаем расчёт
        rating_service.compute_ratings_for_tournament(t.id)
        self.stdout.write(self.style.SUCCESS("Пересчёт рейтинга для турнира выполнен"))
