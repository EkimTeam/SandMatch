from django.core.management.base import BaseCommand
from django.db import transaction
from collections import defaultdict

from apps.players.models import Player
from apps.players.services import rating_service
from apps.tournaments.models import Tournament
from apps.matches.models import Match


class Command(BaseCommand):
    help = (
        "Инициализировать стартовые рейтинги игроков по истории участий HARD/MEDIUM и пересчитать рейтинг "
        "для всех завершённых турниров в хронологическом порядке с приоритетом названий."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true', default=False,
            help='Показать план действий и статистику, не меняя данные'
        )

    @transaction.atomic
    def handle(self, *args, **options):
        dry_run: bool = options['dry_run']

        # 1) Подсчёт участий по HARD/MEDIUM на основе названия турнира
        # Смотрим только завершённые матчи
        matches = (
            Match.objects
            .filter(status=Match.Status.COMPLETED)
            .select_related('tournament', 'team_1', 'team_2')
        )

        hard_medium_count = defaultdict(lambda: {'hard': 0, 'medium': 0, 'any': 0})
        tournaments_processed = set()
        for m in matches:
            t = m.tournament
            if not t:
                continue
            name_lc = (t.name or '').lower()
            is_hard = 'hard' in name_lc
            is_medium = 'medium' in name_lc

            # Собираем игроков из обеих команд
            p_ids = []
            if getattr(m.team_1, 'player_1_id', None):
                p_ids.append(m.team_1.player_1_id)
            if getattr(m.team_1, 'player_2_id', None):
                p_ids.append(m.team_1.player_2_id)
            if getattr(m.team_2, 'player_1_id', None):
                p_ids.append(m.team_2.player_1_id)
            if getattr(m.team_2, 'player_2_id', None):
                p_ids.append(m.team_2.player_2_id)

            for pid in filter(None, p_ids):
                if is_hard:
                    hard_medium_count[pid]['hard'] += 1
                elif is_medium:
                    hard_medium_count[pid]['medium'] += 1
                hard_medium_count[pid]['any'] += 1
            tournaments_processed.add(t.id)

        # 2) Определяем стартовые рейтинги по игрокам
        start_map: dict[int, float] = {}
        all_player_ids = list(Player.objects.values_list('id', flat=True))
        for pid in all_player_ids:
            cnt = hard_medium_count.get(pid, {'hard': 0, 'medium': 0, 'any': 0})
            any_cnt = cnt['any']
            if any_cnt == 0:
                start_map[pid] = 0
            else:
                if cnt['hard'] > cnt['medium']:
                    start_map[pid] = 1100
                elif cnt['medium'] > cnt['hard']:
                    start_map[pid] = 900
                else:
                    # приблизительно равномерно (или только "другие" турниры) → 1000
                    start_map[pid] = 1000

        # 3) Список завершённых турниров в порядке дата ↑, при совпадении — по названию
        completed_qs = Tournament.objects.filter(status=Tournament.Status.COMPLETED)
        completed_ids = list(completed_qs.values_list('id', flat=True))

        # Статистика до пересчёта
        matches_count = matches.count()
        players_participated = sum(1 for pid, v in hard_medium_count.items() if v['any'] > 0)
        tournaments_count = completed_qs.count()

        self.stdout.write(
            f"Найдено завершённых турниров: {tournaments_count}; завершённых матчей: {matches_count}; игроков участвовало: {players_participated}"
        )

        if dry_run:
            # Показать распределение (сводно)
            hard_major = sum(1 for v in hard_medium_count.values() if v['hard'] > v['medium'])
            med_major = sum(1 for v in hard_medium_count.values() if v['medium'] > v['hard'])
            equal_or_other = players_participated - hard_major - med_major
            self.stdout.write(
                f"DRY-RUN: стартовые — HARD: {hard_major}, MEDIUM: {med_major}, 1000: {equal_or_other}, без игр: {len(all_player_ids) - players_participated}"
            )
            return

        # 4) Обнулить всем текущий рейтинг по стартовой карте и запустить полный пересчёт только по завершённым турнирам
        # Очистка истории в рамках recompute_history
        options = rating_service.RecomputeOptions(
            from_date=None,
            to_date=None,
            tournaments=completed_ids,
            start_rating=1000.0,  # не используется, т.к. передаём персональные старты
            start_ratings_per_player=start_map,
            wipe_history=True,
        )
        rating_service.recompute_history(options)

        # 5) Итоговая статистика
        # Перечитаем агрегаты по количеству записей
        from apps.players.models import PlayerRatingHistory, PlayerRatingDynamic
        hist_cnt = PlayerRatingHistory.objects.count()
        dyn_cnt = PlayerRatingDynamic.objects.count()
        self.stdout.write(self.style.SUCCESS(
            f"Готово. Обработано турниров: {tournaments_count}; матчей: {matches_count}; игроков: {players_participated}.\n"
            f"История матчей записей: {hist_cnt}; агрегатов по турнирам: {dyn_cnt}."
        ))
