from __future__ import annotations

from collections import defaultdict
from typing import Dict

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import Tournament, TournamentEntry, TournamentEntryStats


def _ensure_stats(entry: TournamentEntry) -> TournamentEntryStats:
    stats, _ = TournamentEntryStats.objects.get_or_create(entry=entry)
    return stats


def _aggregate_for_group(tournament: Tournament, group_index: int) -> Dict[int, dict]:
    """Возвращает словарь team_id -> агрегаты (wins, sets_won, sets_lost, games_won, games_lost) по группе."""
    agg = defaultdict(lambda: {"wins": 0, "sets_won": 0, "sets_lost": 0, "games_won": 0, "games_lost": 0})

    matches = (
        Match.objects.filter(tournament=tournament, stage=Match.Stage.GROUP, group_index=group_index)
        .prefetch_related("sets")
    )
    for m in matches:
        t1 = m.team_1_id
        t2 = m.team_2_id
        sets_won_1 = 0
        sets_won_2 = 0
        games_1 = 0
        games_2 = 0
        for s in m.sets.all().order_by("index"):
            if s.is_tiebreak_only:
                # Победа в сете определяется по очкам TB
                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                # Игры при TB-only считаем как очки TB, чтобы метрика "геймы" не была пустой
                games_1 += s.games_1
                games_2 += s.games_2
            else:
                # Обычный сет
                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                # При равенстве геймов смотрим тай-брейк
                elif (s.tb_1 is not None) and (s.tb_2 is not None):
                    if s.tb_1 > s.tb_2:
                        sets_won_1 += 1
                    elif s.tb_2 > s.tb_1:
                        sets_won_2 += 1
                games_1 += s.games_1
                games_2 += s.games_2
        agg[t1]["sets_won"] += sets_won_1
        agg[t1]["sets_lost"] += sets_won_2
        agg[t1]["games_won"] += games_1
        agg[t1]["games_lost"] += games_2
        agg[t2]["sets_won"] += sets_won_2
        agg[t2]["sets_lost"] += sets_won_1
        agg[t2]["games_won"] += games_2
        agg[t2]["games_lost"] += games_1
        # Победы по победителю матча
        if m.winner_id == t1:
            agg[t1]["wins"] += 1
        elif m.winner_id == t2:
            agg[t2]["wins"] += 1

    return agg


@transaction.atomic
def recalc_group_stats(tournament: Tournament, group_index: int) -> int:
    """Пересчитывает и сохраняет TournamentEntryStats для всех участников заданной группы.
    Возвращает количество обновлённых записей.
    """
    agg = _aggregate_for_group(tournament, group_index)

    updated = 0
    entries = TournamentEntry.objects.filter(tournament=tournament, group_index=group_index).select_related("team")
    for e in entries:
        st = _ensure_stats(e)
        data = agg.get(e.team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "games_won": 0, "games_lost": 0})
        st.wins = data["wins"]
        st.sets_won = data["sets_won"]
        st.sets_lost = data["sets_lost"]
        st.games_won = data["games_won"]
        st.games_lost = data["games_lost"]
        st.save()
        updated += 1
    return updated


@transaction.atomic
def recalc_tournament_stats(tournament: Tournament) -> int:
    """Пересчитывает статистику по всем группам турнира. Возвращает число обновлённых записей."""
    total = 0
    group_indices = (
        TournamentEntry.objects.filter(tournament=tournament)
        .values_list("group_index", flat=True)
        .distinct()
    )
    for gi in group_indices:
        total += recalc_group_stats(tournament, gi)
    return total
