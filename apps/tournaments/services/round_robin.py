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
    """Формирует туры круговой системы (алгоритм Бергера) с балансировкой порядка.

    - Чётное N: ровно N-1 туров, каждая команда играет 1 матч за тур.
    - Нечётное N: добавляется BYE (None), получаем N туров; пары с BYE пропускаем.
    - Баланс: чередуем порядок пар (условно дом/гости) по чётности тура и индекса пары.
    """
    ids = list(team_ids)
    n = len(ids)
    if n < 2:
        return []

    bye = None
    if n % 2 != 0:
        ids.append(bye)
        n += 1

    fixed = ids[0]
    rotating = ids[1:]

    rounds: List[List[Tuple[int, int]]] = []
    for round_num in range(n - 1):
        pairs: List[Tuple[int, int]] = []

        # Пара с фиксированной командой
        if fixed is not None and rotating[-1] is not None:
            if round_num % 2 == 0:
                pairs.append((fixed, rotating[-1]))
            else:
                pairs.append((rotating[-1], fixed))

        # Остальные пары симметрично из rotating
        for i in range((n - 2) // 2):
            a = rotating[i]
            b = rotating[n - 3 - i]
            if a is None or b is None:
                continue
            if (round_num + i) % 2 == 0:
                pairs.append((a, b))
            else:
                pairs.append((b, a))

        rounds.append(pairs)
        # Вращаем список (кроме фиксированного)
        rotating = [rotating[-1]] + rotating[:-1]

    return rounds


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
        round_name = f"Группа {gi + 1}"
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
