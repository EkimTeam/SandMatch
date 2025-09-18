from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import Tournament, TournamentEntry


@dataclass
class GeneratedMatch:
    team1_id: int
    team2_id: int
    round_name: str
    order_in_round: int


def _split_into_groups(team_ids: List[int], groups_count: int) -> List[List[int]]:
    groups: List[List[int]] = [[] for _ in range(groups_count)]
    for i, tid in enumerate(team_ids):
        groups[i % groups_count].append(tid)
    return groups


def _round_robin_pairings(team_ids: Sequence[int]) -> List[List[Tuple[int, int]]]:
    """Реализация алгоритма «круговой системы» (circle method).

    Возвращает список туров; каждый тур — список пар (team1_id, team2_id).
    Если кол-во участников нечётное — добавляется bye (None), матчи с bye пропускаем.
    """
    ids = list(team_ids)
    n = len(ids)
    if n < 2:
        return []

    bye: Optional[int] = None
    if n % 2 == 1:
        ids.append(-1)  # маркер bye
        bye = -1
        n += 1

    half = n // 2
    left = ids[:half]
    right = ids[half:][::-1]

    rounds: List[List[Tuple[int, int]]] = []
    for _ in range(n - 1):
        pairs: List[Tuple[int, int]] = []
        for a, b in zip(left, right):
            if bye is not None and (a == bye or b == bye):
                continue
            pairs.append((a, b))
        rounds.append(pairs)
        # ротация
        left_mid = left[1:]
        right_mid = right[:-1]
        left = [left[0]] + [right[-1]] + left_mid
        right = [right[0]] + right_mid
    return rounds


def _letter(idx: int) -> str:
    return chr(ord("A") + idx)


def generate_round_robin_matches(tournament: Tournament) -> List[GeneratedMatch]:
    if tournament.system != Tournament.System.ROUND_ROBIN:
        raise ValueError("Турнир не в режимe круговой системы")

    team_ids = list(
        TournamentEntry.objects.filter(tournament=tournament).values_list("team_id", flat=True).order_by("team_id")
    )
    if not team_ids:
        return []

    groups = _split_into_groups(team_ids, max(1, tournament.groups_count))

    existing = set(
        Match.objects.filter(tournament=tournament).values_list("team_1_id", "team_2_id", "round_name")
    )

    generated: List[GeneratedMatch] = []
    for gi, group in enumerate(groups):
        rr = _round_robin_pairings(group)
        round_name = f"Группа {_letter(gi)}"
        order = 1
        for tour_pairs in rr:
            for t1, t2 in tour_pairs:
                key = (t1, t2, round_name)
                key_rev = (t2, t1, round_name)
                if key in existing or key_rev in existing:
                    continue
                generated.append(GeneratedMatch(t1, t2, round_name, order))
                order += 1

    return generated


@transaction.atomic
def persist_generated_matches(tournament: Tournament, matches: Iterable[GeneratedMatch]) -> int:
    created = 0
    for m in matches:
        obj, was_created = Match.objects.get_or_create(
            tournament=tournament,
            team_1_id=m.team1_id,
            team_2_id=m.team2_id,
            round_name=m.round_name,
            defaults={"order_in_round": m.order_in_round},
        )
        if was_created:
            created += 1
    return created
