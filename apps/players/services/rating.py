from __future__ import annotations
from dataclasses import dataclass
from typing import Dict, List, Tuple
from django.db import transaction
from django.db.models import Q

from apps.tournaments.models import Tournament
from apps.matches.models import Match, MatchSet
from apps.teams.models import Team
from apps.players.models import Player, PlayerRatingHistory, PlayerRatingDynamic


K_FACTOR_DEFAULT = 32.0


def _team_players(team: Team) -> List[Player]:
    if team.player_2_id:
        return [team.player_1, team.player_2]
    return [team.player_1]


def _team_rating_at_start(team: Team, player_start_ratings: Dict[int, int]) -> float:
    players = _team_players(team)
    vals = [float(player_start_ratings.get(p.id, p.current_rating or 0)) for p in players]
    if not vals:
        return 0.0
    if len(vals) == 1:
        return vals[0]
    return sum(vals) / len(vals)


def _expected_score(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def _format_modifier(match: Match) -> float:
    sets = list(match.sets.all().order_by("index"))
    if not sets:
        return 1.0
    if len(sets) == 1:
        s = sets[0]
        if s.is_tiebreak_only:
            return 0.3
        return 1.0
    # 2+ сетов: 1.0 + (N-1)*0.1 + diff_sets*0.1
    team1_sets = 0
    team2_sets = 0
    for s in sets:
        if s.is_tiebreak_only:
            if s.games_1 > s.games_2:
                team1_sets += 1
            else:
                team2_sets += 1
        else:
            if s.games_1 > s.games_2:
                team1_sets += 1
            elif s.games_2 > s.games_1:
                team2_sets += 1
            elif s.tb_1 is not None and s.tb_2 is not None:
                if s.tb_1 > s.tb_2:
                    team1_sets += 1
                else:
                    team2_sets += 1
    total_sets = len(sets)
    diff = abs(team1_sets - team2_sets)
    return 1.0 + (total_sets - 1) * 0.1 + diff * 0.1


@transaction.atomic
def recalculate_ratings_for_tournament(tournament_id: int, *, k_factor: float = K_FACTOR_DEFAULT) -> Dict[int, float]:
    """
    Пересчёт рейтинга для турнира по правилам:
    - Изменения накапливаются в течение турнира, применяются после завершения (одним шагом).
    - В PlayerRatingHistory фиксируем изменения по каждому матчу (value = новый рейтинг игрока É ПО МАТЧУ).
      Поле reason содержит сведения о модификаторах/деталях.
    - В PlayerRatingDynamic фиксируем итог по турниру.
    - В Player.current_rating пишем новое финальное значение.
    Возвращает словарь {player_id: new_rating}.
    """
    t = Tournament.objects.select_for_update().get(pk=tournament_id)
    # Собираем завершённые матчи турнира
    matches = (
        Match.objects.filter(tournament=t, status=Match.Status.COMPLETED)
        .select_related("team_1__player_1", "team_1__player_2", "team_2__player_1", "team_2__player_2")
        .prefetch_related("sets")
        .order_by("created_at", "id")
    )

    # Стартовые рейтинги игроков на момент начала турнира — берём current_rating
    player_start_ratings: Dict[int, float] = {}
    def ensure_player(p: Player | None):
        if p and p.id not in player_start_ratings:
            player_start_ratings[p.id] = float(p.current_rating or 1000)

    for m in matches:
        if m.team_1:
            ensure_player(m.team_1.player_1)
            ensure_player(m.team_1.player_2)
        if m.team_2:
            ensure_player(m.team_2.player_1)
            ensure_player(m.team_2.player_2)

    # Накопитель изменений за турнир
    player_delta: Dict[int, float] = {pid: 0.0 for pid in player_start_ratings.keys()}
    player_match_seq: Dict[int, List[Tuple[int, float, float]]] = {pid: [] for pid in player_start_ratings.keys()}  # (match_id, change, fmt)

    for m in matches:
        if not (m.team_1_id and m.team_2_id and m.winner_id):
            continue
        team1 = m.team_1
        team2 = m.team_2
        team1_players = [p for p in _team_players(team1) if p]
        team2_players = [p for p in _team_players(team2) if p]
        if not team1_players or not team2_players:
            continue

        team1_rating = _team_rating_at_start(team1, player_start_ratings)
        team2_rating = _team_rating_at_start(team2, player_start_ratings)
        fmt = _format_modifier(m)

        team1_score = 1.0 if m.winner_id == team1.id else 0.0
        team2_score = 1.0 - team1_score

        exp1 = _expected_score(team1_rating, team2_rating)
        exp2 = _expected_score(team2_rating, team1_rating)

        delta_team1 = k_factor * fmt * (team1_score - exp1)
        delta_team2 = k_factor * fmt * (team2_score - exp2)

        # Каждому игроку добавляем изменение команды
        for p in team1_players:
            player_delta[p.id] = player_delta.get(p.id, 0.0) + delta_team1
            player_match_seq.setdefault(p.id, []).append((m.id, delta_team1, fmt))
        for p in team2_players:
            player_delta[p.id] = player_delta.get(p.id, 0.0) + delta_team2
            player_match_seq.setdefault(p.id, []).append((m.id, delta_team2, fmt))

    # Применяем изменения: записываем историю по матчам, агр. по турниру и обновляем current_rating
    # 1) История по матчам (value = промежуточное значение после матча)
    for pid, seq in player_match_seq.items():
        running = float(player_start_ratings.get(pid, 1000))
        for match_id, change, fmt in seq:
            running += change
            PlayerRatingHistory.objects.create(
                player_id=pid,
                value=int(round(running)),
                reason=f"k={k_factor}; fmt={fmt:.2f}",  # fmt из последнего матча в seq не хранится по-отдельности; это упрощение
                tournament_id=t.id,
                match_id=match_id,
            )

    # 2) Динамика по турниру
    for pid, start in player_start_ratings.items():
        delta = player_delta.get(pid, 0.0)
        after = int(round(start + delta))
        total_change = int(round(delta))
        matches_count = len(player_match_seq.get(pid, []))
        if matches_count == 0:
            continue
        PlayerRatingDynamic.objects.update_or_create(
            player_id=pid,
            tournament_id=t.id,
            defaults={
                "rating_before": int(round(start)),
                "rating_after": after,
                "total_change": total_change,
                "matches_count": matches_count,
            },
        )

    # 3) Обновляем текущий рейтинг игрока
    to_update: List[Tuple[int, int]] = []
    for pid, start in player_start_ratings.items():
        total = int(round(start + player_delta.get(pid, 0.0)))
        to_update.append((pid, total))
    if to_update:
        for pid, val in to_update:
            Player.objects.filter(pk=pid).update(current_rating=val)

    return {pid: val for pid, val in to_update}


