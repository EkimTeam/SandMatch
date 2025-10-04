from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

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
    # Определим, является ли формат турнира режимом "только тай-брейк"
    # Эвристика: max_sets == 1 и allow_tiebreak_only_set == True
    set_format = getattr(tournament, "set_format", None)
    only_tiebreak_mode = False
    if set_format is not None:
        try:
            only_tiebreak_mode = bool(getattr(set_format, "allow_tiebreak_only_set", False)) and int(getattr(set_format, "max_sets", 1)) == 1
        except Exception:
            only_tiebreak_mode = False

    for m in matches:
        t1 = m.team_1_id
        t2 = m.team_2_id
        sets_won_1 = 0
        sets_won_2 = 0
        games_1 = 0
        games_2 = 0
        for s in m.sets.all().order_by("index"):
            if s.is_tiebreak_only:
                # Чемпионский TB: всегда 1:0/0:1 по сетам.
                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                    # В геймы добавляем 1:0 (кроме режима only_tiebreak, где считаем TB очками)
                    if only_tiebreak_mode:
                        games_1 += s.games_1
                        games_2 += s.games_2
                    else:
                        games_1 += 1
                        # проигравшей стороне ничего не добавляем
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                    if only_tiebreak_mode:
                        games_1 += s.games_1
                        games_2 += s.games_2
                    else:
                        games_2 += 1
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


def rank_group(tournament: Tournament, group_index: int, agg: Dict[int, dict]) -> list[int]:
    """Ранжирование команд внутри группы по правилам:
    1) Победы в матчах (wins)
    2) Соотношение сетов (sets_won / (sets_won + sets_lost))
    3) Соотношение геймов (games_won / (games_won + games_lost))
    4) По названию команды (алфавит), как стабильный финальный тайбрейкер
    """
    # Получим имена команд для финального тайбрейкера
    name_by_team: Dict[int, str] = {}
    from apps.tournaments.models import TournamentEntry
    for e in TournamentEntry.objects.filter(tournament=tournament, group_index=group_index).select_related("team"):
        name_by_team[e.team_id] = str(e.team)

    def key(team_id: int):
        d = agg.get(team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "games_won": 0, "games_lost": 0})
        sets_total = d["sets_won"] + d["sets_lost"]
        games_total = d["games_won"] + d["games_lost"]
        sets_ratio = (d["sets_won"] / sets_total) if sets_total > 0 else 0.0
        games_ratio = (d["games_won"] / games_total) if games_total > 0 else 0.0
        return (
            -d["wins"],
            -sets_ratio,
            -games_ratio,
            (name_by_team.get(team_id) or "").lower(),
        )

    # Отсортируем team_ids, присутствующих в группе
    team_ids = list(agg.keys())
    team_ids.sort(key=key)
    return team_ids


def _head_to_head_winner(tournament: Tournament, group_index: int, team_a: int, team_b: int) -> int | None:
    """Вернуть id команды-победителя личной встречи внутри группы или None, если нет данных."""
    from apps.matches.models import Match
    m = (
        Match.objects.filter(
            tournament=tournament,
            stage=Match.Stage.GROUP,
            group_index=group_index,
            team_1_id=team_a,
            team_2_id=team_b,
        ).first()
        or Match.objects.filter(
            tournament=tournament,
            stage=Match.Stage.GROUP,
            group_index=group_index,
            team_1_id=team_b,
            team_2_id=team_a,
        ).first()
    )
    if not m or not m.winner_id:
        return None
    return int(m.winner_id)


def rank_group_with_ruleset(tournament: Tournament, group_index: int, agg: Dict[int, dict]) -> List[int]:
    """Ранжирование по правилам из Ruleset.ordering_priority.

    Поддерживаемые критерии: wins, sets_ratio, games_ratio, h2h, name.
    """
    ruleset = getattr(tournament, "ruleset", None)
    priority: List[str] = []
    if ruleset is not None:
        try:
            raw = getattr(ruleset, "ordering_priority", [])
            if isinstance(raw, list):
                priority = [str(x) for x in raw]
        except Exception:
            priority = []
    if not priority:
        priority = ["wins", "sets_ratio", "games_ratio", "name"]

    # Предрасчёт вспомогательных величин
    sets_ratio: Dict[int, float] = {}
    games_ratio: Dict[int, float] = {}
    name_by_team: Dict[int, str] = {}
    from apps.tournaments.models import TournamentEntry
    for e in TournamentEntry.objects.filter(tournament=tournament, group_index=group_index).select_related("team"):
        name_by_team[e.team_id] = str(e.team)
        d = agg.get(e.team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "games_won": 0, "games_lost": 0})
        st = d["sets_won"] + d["sets_lost"]
        gt = d["games_won"] + d["games_lost"]
        sets_ratio[e.team_id] = (d["sets_won"] / st) if st > 0 else 0.0
        games_ratio[e.team_id] = (d["games_won"] / gt) if gt > 0 else 0.0

    teams = list(agg.keys())

    def cmp(a: int, b: int) -> int:
        # Возвращает -1 если a выше b, 1 если ниже, 0 если равны
        for crit in priority:
            if crit == "wins":
                wa = agg[a]["wins"]; wb = agg[b]["wins"]
                if wa != wb: return -1 if wa > wb else 1
            elif crit == "sets_ratio":
                sa = sets_ratio.get(a, 0.0); sb = sets_ratio.get(b, 0.0)
                if sa != sb: return -1 if sa > sb else 1
            elif crit == "games_ratio":
                ga = games_ratio.get(a, 0.0); gb = games_ratio.get(b, 0.0)
                if ga != gb: return -1 if ga > gb else 1
            elif crit == "h2h":
                w = _head_to_head_winner(tournament, group_index, a, b)
                if w is not None and w in (a, b):
                    return -1 if w == a else 1
            elif crit == "name":
                na = (name_by_team.get(a) or "").lower(); nb = (name_by_team.get(b) or "").lower()
                if na != nb: return -1 if na < nb else 1
            else:
                # неизвестный критерий — пропускаем
                continue
        return 0

    # Стабильная сортировка по cmp
    from functools import cmp_to_key
    teams.sort(key=cmp_to_key(cmp))
    return teams
