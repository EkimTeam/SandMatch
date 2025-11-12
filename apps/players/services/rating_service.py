from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from django.db import transaction

from apps.players.models import Player, PlayerRatingHistory, PlayerRatingDynamic
from apps.tournaments.models import Tournament
from apps.matches.models import Match, MatchSet


@dataclass
class RecomputeOptions:
    from_date: Optional[str] = None  # 'YYYY-MM-DD'
    to_date: Optional[str] = None
    tournaments: Optional[List[int]] = None
    start_rating: float = 1000.0
    start_ratings_per_player: Optional[Dict[int, float]] = None
    wipe_history: bool = False


def _expected(team_rating: float, opponent_rating: float) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent_rating - team_rating) / 400.0))


def _team_rating(p1: float, p2: Optional[float]) -> float:
    return (p1 + (p2 if p2 is not None else p1)) / 2.0


def _format_modifier(match_id: int) -> float:
    sets = list(MatchSet.objects.filter(match_id=match_id).order_by('index'))
    if not sets:
        return 1.0
    total_sets = len(sets)
    if total_sets == 1:
        s = sets[0]
        return 0.3 if s.is_tiebreak_only else 1.0
    # 2+ сетов: 1.0 + (N-1)*0.1 + |diff_sets|*0.1
    sets_won_a = 0
    sets_won_b = 0
    for s in sets:
        if s.games_1 > s.games_2:
            sets_won_a += 1
        else:
            sets_won_b += 1
    base = 1.0 + (total_sets - 1) * 0.1
    diff_bonus = abs(sets_won_a - sets_won_b) * 0.1
    return base + diff_bonus


@transaction.atomic
def compute_ratings_for_tournament(tournament_id: int, k_factor: float = 32.0) -> None:
    """
    Полный расчёт рейтинга для одного турнира:
    - Накапливаем изменения по матчам внутри турнира, но применяем к игрокам одним действием (после турнира)
    - Пишем per-match записи в PlayerRatingHistory (значение = rating_after, reason = модификаторы)
    - Пишем агрегат в PlayerRatingDynamic
    - Обновляем Player.current_rating
    """
    tournament = Tournament.objects.select_for_update().get(id=tournament_id)
    tournament_date = getattr(tournament, 'date', None)

    matches = (
        Match.objects
        .filter(tournament_id=tournament_id, status=Match.Status.COMPLETED)
        .select_related('team_1', 'team_2')
        .order_by('id')
    )

    # Собираем всех вовлечённых игроков
    player_ids: set[int] = set()
    for m in matches:
        for p in [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None),
                  getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)]:
            if p:
                player_ids.add(p)

    players_map: Dict[int, Player] = Player.objects.in_bulk(player_ids)
    # Текущие рейтинги на вход турнира
    ratings_before: Dict[int, float] = {pid: float(p.current_rating or 0.0) for pid, p in players_map.items()}
    # Накопленные изменения по игрокам за турнир
    delta_by_player: Dict[int, float] = {pid: 0.0 for pid in player_ids}
    # Пер-матч журнал для агрегирования истории
    per_match_records: Dict[int, List[Tuple[int, float, float]]] = {pid: [] for pid in player_ids}

    for m in matches:
        if not m.winner_id or not m.team_1 or not m.team_2:
            continue
        t1_p1 = getattr(m.team_1, 'player_1_id', None)
        t1_p2 = getattr(m.team_1, 'player_2_id', None)
        t2_p1 = getattr(m.team_2, 'player_1_id', None)
        t2_p2 = getattr(m.team_2, 'player_2_id', None)
        if not t1_p1 or not t2_p1:
            continue

        # Рейтинги игроков на начало турнира (без применения промежуточных изменений)
        t1_r1 = ratings_before.get(t1_p1, 0.0)
        t1_r2 = ratings_before.get(t1_p2, t1_r1) if t1_p2 else t1_r1
        t2_r1 = ratings_before.get(t2_p1, 0.0)
        t2_r2 = ratings_before.get(t2_p2, t2_r1) if t2_p2 else t2_r1
        team1_rating = _team_rating(t1_r1, t1_r2)
        team2_rating = _team_rating(t2_r1, t2_r2)

        actual1 = 1.0 if (m.winner_id == getattr(m, 'team_1_id', None) or m.winner_id == getattr(m.team_1, 'id', None)) else 0.0
        actual2 = 1.0 - actual1
        fmt = _format_modifier(m.id)
        reason_base = f"K={k_factor};FMT={fmt:.2f}"

        # Изменение для игроков команды 1
        exp1 = _expected(team1_rating, team2_rating)
        change1 = k_factor * fmt * (actual1 - exp1)
        for pid in filter(None, [t1_p1, t1_p2]):
            delta_by_player[pid] = delta_by_player.get(pid, 0.0) + change1
            # Запомним per-match запись (match_id, delta, fmt) для последующей записи
            per_match_records[pid].append((m.id, change1, fmt))

        # Изменение для игроков команды 2
        exp2 = _expected(team2_rating, team1_rating)
        change2 = k_factor * fmt * (actual2 - exp2)
        for pid in filter(None, [t2_p1, t2_p2]):
            delta_by_player[pid] = delta_by_player.get(pid, 0.0) + change2
            per_match_records[pid].append((m.id, change2, fmt))

    # Применяем изменения: обновляем current_rating и пишем историю
    total_matches_by_player: Dict[int, int] = {pid: len(per_match_records.get(pid, [])) for pid in player_ids}
    for pid, player in players_map.items():
        before = ratings_before.get(pid, 0.0)
        total_delta = delta_by_player.get(pid, 0.0)
        after = before + total_delta
        # Обновляем текущий рейтинг округлённо до int (по модели IntegerField)
        player.current_rating = int(round(after))
        player.save(update_fields=["current_rating"])

        # Пер-матч история: значение = rating_after после конкретного матча в рамках турнира
        rolling = before
        for match_id, dlt, fmt in per_match_records.get(pid, []):
            rolling += dlt
            PlayerRatingHistory.objects.create(
                player_id=pid,
                value=int(round(rolling)),
                tournament_id=tournament_id,
                match_id=match_id,
                reason=f"fmt={fmt:.2f}"
            )

        # Агрегат по турниру
        PlayerRatingDynamic.objects.update_or_create(
            player_id=pid,
            tournament_id=tournament_id,
            defaults={
                'tournament_date': tournament_date,
                'rating_before': before,
                'rating_after': after,
                'total_change': total_delta,
                'matches_count': total_matches_by_player.get(pid, 0),
                'meta': None,
            }
        )


@transaction.atomic
def recompute_history(options: RecomputeOptions) -> None:
    """
    Полный пересчёт истории рейтинга согласно заданным опциям.
    - Опционально чистим историю
    - Устанавливаем стартовые рейтинги
    - Идём по турнирам по дате, при совпадении даты — сортируем по названию: сначала включающие "редварит", затем "инал", затем остальные
    - Считаем каждый турнир функцией compute_ratings_for_tournament
    """
    if options.wipe_history:
        PlayerRatingHistory.objects.all().delete()
        PlayerRatingDynamic.objects.all().delete()

    # Инициализация стартовых рейтингов
    if options.start_ratings_per_player:
        for pid, val in options.start_ratings_per_player.items():
            Player.objects.filter(id=pid).update(current_rating=int(round(val)))
    else:
        # Глобальный старт, если у игрока рейтинг нулевой
        Player.objects.filter(current_rating=0).update(current_rating=int(round(options.start_rating)))

    qs = Tournament.objects.all()
    if options.from_date:
        qs = qs.filter(date__gte=options.from_date)
    if options.to_date:
        qs = qs.filter(date__lte=options.to_date)
    if options.tournaments:
        qs = qs.filter(id__in=options.tournaments)

    def _priority_name(name: str) -> Tuple[int, str]:
        n = (name or '').lower()
        if 'редварит' in n:
            return (0, n)
        if 'инал' in n:
            return (1, n)
        return (2, n)

    tournaments = list(qs)
    tournaments.sort(key=lambda t: (getattr(t, 'date', None) or '1900-01-01',) + _priority_name(getattr(t, 'name', '')))

    for t in tournaments:
        compute_ratings_for_tournament(t.id)
