from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import (
    KnockoutBracket,
    Tournament,
    TournamentEntry,
    TournamentPlacement,
)
from apps.tournaments.services.stats import _aggregate_for_group, rank_group_with_ruleset
from apps.tournaments.services.king_stats import (
    _aggregate_for_king_group,
    compute_king_group_ranking,
)


@dataclass
class PlacementRange:
    place_from: int
    place_to: int


def _clear_tournament_placements(tournament: Tournament) -> None:
    TournamentPlacement.objects.filter(tournament=tournament).delete()


def _create_placements(
    tournament: Tournament,
    entries_with_places: Iterable[Tuple[TournamentEntry, PlacementRange]],
) -> None:
    bulk: List[TournamentPlacement] = []
    for entry, pr in entries_with_places:
        bulk.append(
            TournamentPlacement(
                tournament=tournament,
                entry=entry,
                place_from=pr.place_from,
                place_to=pr.place_to,
            )
        )
    TournamentPlacement.objects.bulk_create(bulk)


def _recalc_round_robin_single_group(tournament: Tournament) -> None:
    # Одна группа: берём group_index=1 и строим места по rank_group_with_ruleset
    entries = (
        TournamentEntry.objects.filter(tournament=tournament, group_index=1)
        .select_related("team")
        .order_by("id")
    )
    if not entries:
        return

    agg = _aggregate_for_group(tournament, 1)
    order_team_ids: List[int] = rank_group_with_ruleset(tournament, 1, agg)

    team_to_entry: Dict[int, TournamentEntry] = {}
    for e in entries:
        if e.team_id is not None:
            team_to_entry[e.team_id] = e

    current_place = 1
    placements: List[Tuple[TournamentEntry, PlacementRange]] = []
    for team_id in order_team_ids:
        entry = team_to_entry.get(team_id)
        if not entry:
            continue
        placements.append((entry, PlacementRange(current_place, current_place)))
        current_place += 1

    _create_placements(tournament, placements)


def _recalc_king_placements(tournament: Tournament) -> None:
    """Пересчитать места для турнира King по текущей логике king_stats.

    Для каждой группы King считаем ранжирование участников и сохраняем
    место как одиночное (place_from == place_to).
    """

    groups_count = max(1, tournament.groups_count or 1)

    entries_with_places: List[Tuple[TournamentEntry, PlacementRange]] = []

    for group_idx in range(1, groups_count + 1):
        # Участники группы King (по row_index)
        entries = list(
            TournamentEntry.objects.filter(tournament=tournament, group_index=group_idx)
            .select_related("team__player_1", "team__player_2")
            .order_by("row_index")
        )
        if not entries:
            continue

        # Матчи группы King в стадии GROUP с указанным group_index
        matches = (
            Match.objects.filter(
                tournament=tournament,
                stage=Match.Stage.GROUP,
                group_index=group_idx,
            )
            .prefetch_related("sets")
            .order_by("round_index", "order_in_round")
        )

        # Формируем group_data в том же формате, что и в king_stats.king_stats
        rounds_dict: Dict[int, List[dict]] = {}
        for m in matches:
            round_idx = m.round_index or 1
            if round_idx not in rounds_dict:
                rounds_dict[round_idx] = []

            team1_players = []
            team2_players = []

            if m.team_1:
                if m.team_1.player_1:
                    team1_players.append(
                        {
                            "id": m.team_1.player_1.id,
                            "name": f"{m.team_1.player_1.last_name} {m.team_1.player_1.first_name}",
                        }
                    )
                if m.team_1.player_2:
                    team1_players.append(
                        {
                            "id": m.team_1.player_2.id,
                            "name": f"{m.team_1.player_2.last_name} {m.team_1.player_2.first_name}",
                        }
                    )

            if m.team_2:
                if m.team_2.player_1:
                    team2_players.append(
                        {
                            "id": m.team_2.player_1.id,
                            "name": f"{m.team_2.player_1.last_name} {m.team_2.player_1.first_name}",
                        }
                    )
                if m.team_2.player_2:
                    team2_players.append(
                        {
                            "id": m.team_2.player_2.id,
                            "name": f"{m.team_2.player_2.last_name} {m.team_2.player_2.first_name}",
                        }
                    )

            rounds_dict[round_idx].append(
                {
                    "id": m.id,
                    "team1_players": team1_players,
                    "team2_players": team2_players,
                }
            )

        if not rounds_dict:
            continue

        rounds_list = [
            {"round": r, "matches": rounds_dict[r]} for r in sorted(rounds_dict.keys())
        ]

        participants_data = []
        for e in entries:
            participants_data.append(
                {
                    "row_index": e.row_index,
                    "team": {
                        "player_1": e.team.player_1_id if e.team else None,
                        "player_2": e.team.player_2_id if e.team else None,
                    },
                    "display_name": (
                        e.team.player_1.display_name if e.team and e.team.player_1 else ""
                    ),
                    "name": (
                        f"{e.team.player_1.last_name} {e.team.player_1.first_name}"
                        if e.team and e.team.player_1
                        else ""
                    ),
                }
            )

        group_data = {"participants": participants_data, "rounds": rounds_list}

        # Режим подсчёта (NO / G- / M+)
        calculation_mode = getattr(tournament, "king_calculation_mode", "no") or "no"

        # Агрегаты и ранжирование по текущей логике King
        stats, compute_stats_fn = _aggregate_for_king_group(
            tournament, group_idx, group_data
        )
        ranks = compute_king_group_ranking(
            tournament,
            group_idx,
            calculation_mode,
            group_data,
            stats,
            compute_stats_fn,
        )

        # Преобразуем rank (1,2,3,...) в места для соответствующих TournamentEntry
        row_to_entry: Dict[int, TournamentEntry] = {}
        for e in entries:
            if e.row_index is not None:
                row_to_entry[int(e.row_index)] = e

        for row_index, place in ranks.items():
            entry = row_to_entry.get(int(row_index))
            if not entry:
                continue
            entries_with_places.append(
                (entry, PlacementRange(place_from=int(place), place_to=int(place)))
            )

    if entries_with_places:
        _create_placements(tournament, entries_with_places)


def _collect_knockout_results_for_bracket(
    bracket: KnockoutBracket,
) -> Dict[int, PlacementRange]:
    """Возвращает словарь entry_id -> диапазон мест для одной сетки.

    Реализовано по классической схеме:
    - финал: победитель 1-е место, проигравший 2-е;
    - матч за 3-е (если есть): победитель 3-е, проигравший 4-е;
    - без матча за 3-е: оба проигравших в полуфиналах получают 3-е место;
    - проигравшие в каждом предыдущем раунде получают общий диапазон мест
      (5-8, 9-16 и т.п.), исходя из размера сетки.
    """
    matches = (
        Match.objects.filter(bracket=bracket)
        .select_related("team_1", "team_2")
        .order_by("round_index", "order_in_round")
    )

    if not matches:
        return {}

    # Группируем матчи по раундам
    rounds: Dict[int, List[Match]] = defaultdict(list)
    for m in matches:
        rounds[m.round_index or 0].append(m)

    max_round = max(rounds.keys()) if rounds else 0

    entry_places: Dict[int, PlacementRange] = {}

    # Финал: берём матч с максимальным round_index среди НЕ is_third_place
    final_round_index = None
    for r in sorted(rounds.keys(), reverse=True):
        if any(not m.is_third_place for m in rounds[r]):
            final_round_index = r
            break

    final_match: Optional[Match] = None
    if final_round_index is not None:
        for m in rounds[final_round_index]:
            if not m.is_third_place:
                final_match = m
                break

    if final_match:
        if final_match.winner_id:
            # Победитель финала → 1-е место
            winner_entry = (
                TournamentEntry.objects.filter(
                    tournament=bracket.tournament, team_id=final_match.winner_id
                )
                .order_by("id")
                .first()
            )
            if winner_entry:
                entry_places[winner_entry.id] = PlacementRange(1, 1)

            # Проигравший финала → 2-е место
            loser_team_id = (
                final_match.team_1_id
                if final_match.team_2_id == final_match.winner_id
                else final_match.team_2_id
            )
            if loser_team_id:
                loser_entry = (
                    TournamentEntry.objects.filter(
                        tournament=bracket.tournament, team_id=loser_team_id
                    )
                    .order_by("id")
                    .first()
                )
                if loser_entry:
                    entry_places[loser_entry.id] = PlacementRange(2, 2)
        else:
            # Фолбэк: финальный матч существует, но winner_id не проставлен.
            # Используем победителей полуфиналов как финалистов и всё равно
            # назначаем им 1-е и 2-е места.
            semifinal_round = (final_round_index or 0) - 1
            semifinal_matches = rounds.get(semifinal_round, [])
            finalist_team_ids: List[int] = []
            for m in semifinal_matches:
                if m.winner_id:
                    finalist_team_ids.append(m.winner_id)

            # Уберём дубликаты, сохранив порядок
            seen: set[int] = set()
            unique_finalists: List[int] = []
            for tid in finalist_team_ids:
                if tid and tid not in seen:
                    seen.add(tid)
                    unique_finalists.append(tid)

            if unique_finalists:
                # Первый финалист → 1-е место, второй (если есть) → 2-е место
                first_tid = unique_finalists[0]
                first_entry = (
                    TournamentEntry.objects.filter(
                        tournament=bracket.tournament, team_id=first_tid
                    )
                    .order_by("id")
                    .first()
                )
                if first_entry:
                    entry_places[first_entry.id] = PlacementRange(1, 1)

                if len(unique_finalists) > 1:
                    second_tid = unique_finalists[1]
                    second_entry = (
                        TournamentEntry.objects.filter(
                            tournament=bracket.tournament, team_id=second_tid
                        )
                        .order_by("id")
                        .first()
                    )
                    if second_entry:
                        entry_places[second_entry.id] = PlacementRange(2, 2)

    # Третье место: ищем матч(is_third_place=True) по всем раундам
    third_place_match = next((m for m in matches if m.is_third_place), None)
    if third_place_match and third_place_match.winner_id:
        # Победитель матча за 3-е → 3-е, проигравший → 4-е
        for team_id, place in [
            (third_place_match.winner_id, 3),
            (
                third_place_match.team_1_id
                if third_place_match.team_2_id == third_place_match.winner_id
                else third_place_match.team_2_id,
                4,
            ),
        ]:
            if team_id:
                e = (
                    TournamentEntry.objects.filter(
                        tournament=bracket.tournament, team_id=team_id
                    )
                    .order_by("id")
                    .first()
                )
                if e and e.id not in entry_places:
                    entry_places[e.id] = PlacementRange(place, place)
    else:
        # Нет матча за 3-е: оба проигравших в полуфиналах получают 3-е место
        semifinal_round = max_round - 1
        semifinal_matches = rounds.get(semifinal_round, [])
        for m in semifinal_matches:
            if not m.winner_id:
                continue
            loser_team_id = (
                m.team_1_id if m.team_2_id == m.winner_id else m.team_2_id
            )
            if not loser_team_id:
                continue
            e = (
                TournamentEntry.objects.filter(
                    tournament=bracket.tournament, team_id=loser_team_id
                )
                .order_by("id")
                .first()
            )
            if e and e.id not in entry_places:
                entry_places[e.id] = PlacementRange(3, 3)

    # Прочие проигравшие раундов: диапазоны мест.
    # Начинаем с предпоследнего раунда (до полуфиналов) и идём вниз.
    size = bracket.size or 0
    current_max_place = size
    # Для 5-8, 9-16 и т.п.
    for round_index in range(max_round - 1, -1, -1):
        if round_index == max_round - 1:
            # Полуфиналы уже частично обработаны для 3-го места; оставшимся проигравшим
            # мы ничего дополнительно не присваиваем.
            continue
        round_matches = rounds.get(round_index, [])
        losers: List[int] = []
        for m in round_matches:
            if not m.winner_id:
                continue
            if m.team_1_id and m.team_1_id != m.winner_id:
                losers.append(m.team_1_id)
            if m.team_2_id and m.team_2_id != m.winner_id:
                losers.append(m.team_2_id)
        if not losers:
            continue
        count = len(losers)
        place_from = current_max_place - count + 1
        place_to = current_max_place
        for team_id in losers:
            e = (
                TournamentEntry.objects.filter(
                    tournament=bracket.tournament, team_id=team_id
                )
                .order_by("id")
                .first()
            )
            if e and e.id not in entry_places:
                entry_places[e.id] = PlacementRange(place_from, place_to)
        current_max_place -= count

    return entry_places


@transaction.atomic
def recalc_tournament_placements(tournament: Tournament) -> int:
    """Пересчитать и сохранить места для турнира.

    Возвращает количество созданных записей TournamentPlacement.
    """
    _clear_tournament_placements(tournament)

    if tournament.system == Tournament.System.ROUND_ROBIN:
        # Пока поддерживаем только одну группу, многогрупповые турниры пропускаем.
        if tournament.groups_count and tournament.groups_count > 1:
            return 0
        _recalc_round_robin_single_group(tournament)
    elif tournament.system == Tournament.System.KING:
        _recalc_king_placements(tournament)
    elif tournament.system == Tournament.System.KNOCKOUT:
        all_places: Dict[int, PlacementRange] = {}
        for bracket in tournament.knockout_brackets.all():
            per_bracket = _collect_knockout_results_for_bracket(bracket)
            all_places.update(per_bracket)

        entries_with_places: List[Tuple[TournamentEntry, PlacementRange]] = []
        for entry_id, pr in all_places.items():
            try:
                entry = TournamentEntry.objects.get(id=entry_id, tournament=tournament)
            except TournamentEntry.DoesNotExist:
                continue
            entries_with_places.append((entry, pr))

        _create_placements(tournament, entries_with_places)
    else:
        return 0

    return TournamentPlacement.objects.filter(tournament=tournament).count()
