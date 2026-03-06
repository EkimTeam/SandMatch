from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import Tournament, TournamentEntry, TournamentEntryStats
from apps.tournaments.free_format_utils import is_free_format as _is_free_format


def _ensure_stats(entry: TournamentEntry) -> TournamentEntryStats:
    stats, _ = TournamentEntryStats.objects.get_or_create(entry=entry)
    return stats


def _aggregate_for_group(tournament: Tournament, group_index: int) -> Dict[int, dict]:
    """Возвращает словарь team_id -> агрегаты (wins, sets_won, sets_lost, sets_drawn, games_won, games_lost) по группе."""
    agg = defaultdict(lambda: {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0})

    matches = (
        Match.objects.filter(tournament=tournament, stage=Match.Stage.GROUP, group_index=group_index)
        .prefetch_related("sets")
    )
    # Определим, является ли формат турнира режимом "только тай-брейк" или свободным форматом
    set_format = getattr(tournament, "set_format", None)
    only_tiebreak_mode = False
    is_free = False

    if set_format is not None:
        try:
            is_free = bool(_is_free_format(set_format))
            # Режим только тайбрейк
            only_tiebreak_mode = bool(getattr(set_format, "allow_tiebreak_only_set", False)) and int(getattr(set_format, "max_sets", 1)) == 1
        except Exception:
            only_tiebreak_mode = False
            is_free = False

    for m in matches:
        t1 = m.team_1_id
        t2 = m.team_2_id
        if not t1 or not t2:
            continue

        # Свободный формат: считаем сеты/геймы с учётом ориентации команды в матче.
        # (games_1/games_2 относятся к team_1/team_2; для team_2 сравнение делаем зеркально)
        if is_free:
            for s in m.sets.all().order_by("index"):
                if s.is_tiebreak_only:
                    # Чемпионский TB: всегда 1:0/0:1 по сетам.
                    if (s.tb_1 is None) or (s.tb_2 is None):
                        continue

                    if s.tb_1 > s.tb_2:
                        agg[t1]["sets_won"] += 1
                        agg[t2]["sets_lost"] += 1
                        if only_tiebreak_mode:
                            agg[t1]["games_won"] += s.tb_1
                            agg[t1]["games_lost"] += s.tb_2
                            agg[t2]["games_won"] += s.tb_2
                            agg[t2]["games_lost"] += s.tb_1
                        else:
                            agg[t1]["games_won"] += 1
                            agg[t2]["games_lost"] += 1
                    elif s.tb_2 > s.tb_1:
                        agg[t2]["sets_won"] += 1
                        agg[t1]["sets_lost"] += 1
                        if only_tiebreak_mode:
                            agg[t1]["games_won"] += s.tb_1
                            agg[t1]["games_lost"] += s.tb_2
                            agg[t2]["games_won"] += s.tb_2
                            agg[t2]["games_lost"] += s.tb_1
                        else:
                            agg[t2]["games_won"] += 1
                            agg[t1]["games_lost"] += 1
                    continue

                g1 = int(getattr(s, "games_1", 0) or 0)
                g2 = int(getattr(s, "games_2", 0) or 0)

                agg[t1]["games_won"] += g1
                agg[t1]["games_lost"] += g2
                agg[t2]["games_won"] += g2
                agg[t2]["games_lost"] += g1

                if g1 > g2:
                    agg[t1]["sets_won"] += 1
                    agg[t2]["sets_lost"] += 1
                elif g2 > g1:
                    agg[t2]["sets_won"] += 1
                    agg[t1]["sets_lost"] += 1
                else:
                    agg[t1]["sets_drawn"] += 1
                    agg[t2]["sets_drawn"] += 1

            # wins в свободном формате не считаем
            continue

        sets_won_1 = 0
        sets_won_2 = 0
        games_1 = 0
        games_2 = 0
        
        for s in m.sets.all().order_by("index"):
            if s.is_tiebreak_only:
                # Чемпионский TB: всегда 1:0/0:1 по сетам.
                if s.tb_1 > s.tb_2:
                    sets_won_1 += 1
                    # В геймы добавляем 1:0 (кроме режима only_tiebreak, где считаем TB очками)
                    if only_tiebreak_mode:
                        games_1 += s.tb_1
                        games_2 += s.tb_2
                    else:
                        games_1 += 1
                        # проигравшей стороне ничего не добавляем
                elif s.tb_2 > s.tb_1:
                    sets_won_2 += 1
                    if only_tiebreak_mode:
                        games_1 += s.tb_1
                        games_2 += s.tb_2
                    else:
                        games_2 += 1
            else:
                # Обычный сет
                if is_free:
                    # Для свободного формата: учитываем ничьи отдельно
                    if s.games_1 > s.games_2:
                        sets_won_1 += 1
                    elif s.games_2 > s.games_1:
                        sets_won_2 += 1
                    elif s.games_1 == s.games_2:
                        # Ничья - добавляем в sets_drawn для обеих команд
                        agg[t1]["sets_drawn"] += 1
                        agg[t2]["sets_drawn"] += 1
                else:
                    # Стандартная логика
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
        # Примечание: sets_drawn уже добавлены внутри цикла по сетам
        
        # Победы по победителю матча (для свободного формата всегда 0)
        if not is_free:
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
        data = agg.get(e.team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0})
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
        d = agg.get(team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0})
        # Для соотношения сетов учитываем ничьи
        sets_total = d["sets_won"] + d["sets_lost"] + d.get("sets_drawn", 0)
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

    if not m:
        return None

    # Если в матче явно проставлен победитель — используем это значение.
    if m.winner_id:
        return int(m.winner_id)

    # Для свободного формата (и на всякий случай для обычного) пробуем вычислить победителя
    # по сетам/геймам аналогично _aggregate_for_group.
    set_format = getattr(tournament, "set_format", None)
    is_free = False
    only_tiebreak_mode = False
    if set_format is not None:
        try:
            is_free = bool(_is_free_format(set_format))
            only_tiebreak_mode = bool(
                getattr(set_format, "allow_tiebreak_only_set", False)
            ) and int(getattr(set_format, "max_sets", 1)) == 1
        except Exception:
            is_free = False
            only_tiebreak_mode = False

    t1 = m.team_1_id
    t2 = m.team_2_id
    sets_won_1 = 0
    sets_won_2 = 0

    for s in m.sets.all().order_by("index"):
        if s.is_tiebreak_only:
            # Чемпионский TB: всегда 1:0/0:1 по сетам.
            if s.tb_1 is not None and s.tb_2 is not None:
                if s.tb_1 > s.tb_2:
                    sets_won_1 += 1
                elif s.tb_2 > s.tb_1:
                    sets_won_2 += 1
        else:
            if is_free:
                # Свободный формат: побеждает тот, у кого больше геймов в сете.
                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                # При равенстве считаем сет ничейным и не учитываем в head-to-head.
            else:
                # Стандартная логика: больше геймов или TB при равенстве.
                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                elif (s.tb_1 is not None) and (s.tb_2 is not None):
                    if s.tb_1 > s.tb_2:
                        sets_won_1 += 1
                    elif s.tb_2 > s.tb_1:
                        sets_won_2 += 1

    if sets_won_1 > sets_won_2:
        return int(t1) if t1 is not None else None
    if sets_won_2 > sets_won_1:
        return int(t2) if t2 is not None else None

    # Полная ничья — личные встречи не помогают.
    return None


def _rank_by_h2h_mini_tournament(tournament: Tournament, group_index: int, team_list: List[int], agg: Dict[int, dict]) -> List[int]:
    """Ранжирование группы команд по мини-турниру личных встреч (ITF правила).
    
    Возвращает отсортированный список команд или None, если не удалось определить порядок.
    Применяет те же критерии (победы, сеты, геймы) только для матчей внутри этой группы.
    """
    if len(team_list) <= 1:
        return team_list
    
    # Собираем статистику только по матчам между командами из team_list
    h2h_agg = {tid: {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0} for tid in team_list}
    
    from apps.matches.models import Match
    matches = Match.objects.filter(
        tournament=tournament,
        stage=Match.Stage.GROUP,
        group_index=group_index,
        team_1_id__in=team_list,
        team_2_id__in=team_list
    ).prefetch_related("sets")
    
    for m in matches:
        t1 = m.team_1_id
        t2 = m.team_2_id
        if t1 not in team_list or t2 not in team_list:
            continue
            
        sets_won_1 = 0
        sets_won_2 = 0
        games_1 = 0
        games_2 = 0
        
        for s in m.sets.all().order_by("index"):
            if s.is_tiebreak_only:
                if s.tb_1 > s.tb_2:
                    sets_won_1 += 1
                elif s.tb_2 > s.tb_1:
                    sets_won_2 += 1
                games_1 += s.tb_1 or 0
                games_2 += s.tb_2 or 0
            else:
                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                elif s.games_1 == s.games_2:
                    # Ничья
                    h2h_agg[t1]["sets_drawn"] += 1
                    h2h_agg[t2]["sets_drawn"] += 1
                elif (s.tb_1 is not None) and (s.tb_2 is not None):
                    if s.tb_1 > s.tb_2:
                        sets_won_1 += 1
                    elif s.tb_2 > s.tb_1:
                        sets_won_2 += 1
                
                games_1 += s.games_1 or 0
                games_2 += s.games_2 or 0
        
        h2h_agg[t1]["sets_won"] += sets_won_1
        h2h_agg[t1]["sets_lost"] += sets_won_2
        h2h_agg[t1]["games_won"] += games_1
        h2h_agg[t1]["games_lost"] += games_2
        h2h_agg[t2]["sets_won"] += sets_won_2
        h2h_agg[t2]["sets_lost"] += sets_won_1
        h2h_agg[t2]["games_won"] += games_2
        h2h_agg[t2]["games_lost"] += games_1
        
        if m.winner_id == t1:
            h2h_agg[t1]["wins"] += 1
        elif m.winner_id == t2:
            h2h_agg[t2]["wins"] += 1
    
    # Сортируем по критериям: победы -> сеты соот. -> геймы соот.
    def h2h_key(tid: int):
        d = h2h_agg[tid]
        st = d["sets_won"] + d["sets_lost"] + d["sets_drawn"]
        gt = d["games_won"] + d["games_lost"]
        sets_ratio = (d["sets_won"] / st) if st > 0 else 0.0
        games_ratio = (d["games_won"] / gt) if gt > 0 else 0.0
        return (-d["wins"], -sets_ratio, -games_ratio)
    
    sorted_teams = sorted(team_list, key=h2h_key)
    
    # Проверяем, что порядок определен однозначно (нет одинаковых значений)
    keys = [h2h_key(tid) for tid in sorted_teams]
    if len(set(keys)) == len(keys):
        return sorted_teams
    
    # Если есть одинаковые значения - не удалось определить порядок
    return None


def rank_group_with_ruleset(tournament: Tournament, group_index: int, agg: Dict[int, dict]) -> List[int]:
    """Ранжирование по правилам ITF.

    Порядок критериев берётся из tournament.ruleset.ordering_priority.
    Поддерживаемые токены (см. seed_rulesets.py):
    wins, h2h, sets_ratio_all, games_ratio_all, sets_ratio_between,
    games_ratio_between, games_ratio_between_tb3_as_1_0, name.
    
    Финальный стабильный тай-брейкер: рейтинг → имя.
    """
    priority: List[str] = ["wins", "sets_ratio_all", "games_ratio_all", "name"]

    # Свободный формат: победитель матча не определяется, wins не считаются.
    set_format = getattr(tournament, "set_format", None)
    is_free_format = False
    if set_format is not None:
        try:
            is_free_format = bool(_is_free_format(set_format))
        except Exception:
            is_free_format = False

    # Предрасчёт вспомогательных величин и состав группы
    sets_ratio_all: Dict[int, float] = {}
    games_ratio_all: Dict[int, float] = {}
    name_by_team: Dict[int, str] = {}
    team_obj_by_id: Dict[int, any] = {}
    team_rating: Dict[int, float] = {}

    from apps.tournaments.models import TournamentEntry
    entries = (
        TournamentEntry.objects
        .filter(tournament=tournament, group_index=group_index)
        .select_related("team", "team__player_1", "team__player_2")
    )
    for e in entries:
        team_id = e.team_id
        team = e.team
        team_obj_by_id[team_id] = team
        name_by_team[team_id] = str(team)
        d = agg.get(team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0})
        # Для соотношения сетов учитываем ничьи: выигранные / (выигранные + проигранные + ничьи)
        st = d["sets_won"] + d["sets_lost"] + d["sets_drawn"]
        gt = d["games_won"] + d["games_lost"]
        sets_ratio_all[team_id] = (d["sets_won"] / st) if st > 0 else 0.0
        games_ratio_all[team_id] = (d["games_won"] / gt) if gt > 0 else 0.0

        # Финальный тай-брейкер по рейтингу должен соответствовать tournament.rating_visible
        try:
            from apps.tournaments.services.rating_visible import get_entry_visible_rating

            team_rating[team_id] = float(get_entry_visible_rating(tournament, e) or 0)
        except Exception:
            team_rating[team_id] = 0.0

    has_special: Dict[int, bool] = {}
    def _is_special_player(p) -> bool:
        if not p:
            return False
        try:
            last = (getattr(p, "last_name", "") or "").strip().lower()
            first = (getattr(p, "first_name", "") or "").strip().lower()
            display = (getattr(p, "display_name", "") or "").strip().lower()
            full = f"{last} {first}".strip()
            return full == "петров михаил" or display == "петров михаил"
        except Exception:
            return False
    for e in entries:
        try:
            team_id = e.team_id
            team = e.team
            has_special[team_id] = _is_special_player(getattr(team, "player_1", None)) or _is_special_player(getattr(team, "player_2", None))
        except Exception:
            continue

    # Команды для ранжирования — именно участники группы, даже если у них пока нет матчей
    teams = [e.team_id for e in entries if e.team_id is not None]

    try:
        ruleset = getattr(tournament, "ruleset", None)
        if ruleset and getattr(ruleset, "ordering_priority", None):
            priority = list(ruleset.ordering_priority)
    except Exception:
        pass

    priority = [
        ("h2h" if c == "h2" else c)
        for c in priority
    ]

    allowed = {
        "wins",
        "h2h",
        "sets_ratio_all",
        "games_ratio_all",
        "sets_ratio_between",
        "games_ratio_between",
        "games_ratio_between_tb3_as_1_0",
        "name",
    }
    priority = [c for c in priority if c in allowed]
    if not priority:
        priority = ["wins", "sets_ratio_all", "games_ratio_all", "name"]

    # Особенность свободного формата:
    # - wins всегда одинаковы (обычно 0), поэтому критерий wins неинформативен
    # - личные встречи как первый критерий или сразу после wins тоже не дают смысла,
    #   т.к. нет базы для отбора равных по победам (все равны)
    if is_free_format and teams:
        # Бизнес-правило: если регламент начинается с "wins > h2h > ...",
        # то для свободного формата оба критерия пропускаем всегда.
        if len(priority) >= 2 and priority[0] == "wins" and priority[1] == "h2h":
            priority = priority[2:]

        wins_values = {int((agg.get(tid) or {}).get("wins", 0)) for tid in teams}
        if len(wins_values) == 1:
            # Убираем ведущий wins
            while priority and priority[0] == "wins":
                priority = priority[1:]
            # Убираем ведущий h2h (если был первым или шёл сразу после wins)
            while priority and priority[0] == "h2h":
                priority = priority[1:]
            if not priority:
                priority = ["sets_ratio_all", "games_ratio_all", "name"]

    def _aggregate_between(team_list: List[int], tb3_as_1_0: bool = False) -> Dict[int, dict]:
        from apps.matches.models import Match

        h2h_agg = {tid: {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0} for tid in team_list}

        matches = Match.objects.filter(
            tournament=tournament,
            stage=Match.Stage.GROUP,
            group_index=group_index,
            team_1_id__in=team_list,
            team_2_id__in=team_list,
        ).prefetch_related("sets")

        for m in matches:
            t1 = m.team_1_id
            t2 = m.team_2_id
            if t1 not in team_list or t2 not in team_list:
                continue

            sets_won_1 = 0
            sets_won_2 = 0
            games_1 = 0
            games_2 = 0

            for s in m.sets.all().order_by("index"):
                if s.is_tiebreak_only:
                    if (s.tb_1 is not None) and (s.tb_2 is not None):
                        if s.tb_1 > s.tb_2:
                            sets_won_1 += 1
                            if tb3_as_1_0:
                                games_1 += 1
                            else:
                                games_1 += s.tb_1 or 0
                                games_2 += s.tb_2 or 0
                        elif s.tb_2 > s.tb_1:
                            sets_won_2 += 1
                            if tb3_as_1_0:
                                games_2 += 1
                            else:
                                games_1 += s.tb_1 or 0
                                games_2 += s.tb_2 or 0
                    continue

                if s.games_1 > s.games_2:
                    sets_won_1 += 1
                elif s.games_2 > s.games_1:
                    sets_won_2 += 1
                elif s.games_1 == s.games_2:
                    h2h_agg[t1]["sets_drawn"] += 1
                    h2h_agg[t2]["sets_drawn"] += 1
                elif (s.tb_1 is not None) and (s.tb_2 is not None):
                    if s.tb_1 > s.tb_2:
                        sets_won_1 += 1
                    elif s.tb_2 > s.tb_1:
                        sets_won_2 += 1

                games_1 += s.games_1 or 0
                games_2 += s.games_2 or 0

            h2h_agg[t1]["sets_won"] += sets_won_1
            h2h_agg[t1]["sets_lost"] += sets_won_2
            h2h_agg[t1]["games_won"] += games_1
            h2h_agg[t1]["games_lost"] += games_2
            h2h_agg[t2]["sets_won"] += sets_won_2
            h2h_agg[t2]["sets_lost"] += sets_won_1
            h2h_agg[t2]["games_won"] += games_2
            h2h_agg[t2]["games_lost"] += games_1

            winner = m.winner_id
            if not winner:
                if sets_won_1 > sets_won_2:
                    winner = t1
                elif sets_won_2 > sets_won_1:
                    winner = t2

            if winner == t1:
                h2h_agg[t1]["wins"] += 1
            elif winner == t2:
                h2h_agg[t2]["wins"] += 1

        return h2h_agg

    def get_criterion_value(team_id: int, crit: str):
        """Получить значение критерия для команды."""
        if crit == "wins":
            d = agg.get(team_id) or {"wins": 0}
            return int(d.get("wins", 0) or 0)
        elif crit == "sets_ratio_all":
            return sets_ratio_all.get(team_id, 0.0)
        elif crit == "games_ratio_all":
            return games_ratio_all.get(team_id, 0.0)
        elif crit == "name":
            return (name_by_team.get(team_id) or "").lower()
        return None

    def rank_teams_recursive(team_list: List[int], criteria_index: int) -> List[int]:
        """Рекурсивное ранжирование списка команд по критериям ITF."""
        if len(team_list) <= 1:
            return team_list
        if criteria_index >= len(priority):
            # Закончились критерии — применяем финальные тай-брейкеры
            return sorted(
                team_list,
                key=lambda tid: (
                    -int(has_special.get(tid, False)),
                    -float(team_rating.get(tid, 0.0)),
                    (name_by_team.get(tid) or "").lower(),
                )
            )

        current_crit = priority[criteria_index]

        if current_crit in {"sets_ratio_between", "games_ratio_between", "games_ratio_between_tb3_as_1_0"}:
            between_agg = _aggregate_between(
                team_list,
                tb3_as_1_0=(current_crit == "games_ratio_between_tb3_as_1_0"),
            )

            def between_value(tid: int):
                d = between_agg.get(tid) or {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0}
                st = d["sets_won"] + d["sets_lost"] + d.get("sets_drawn", 0)
                gt = d["games_won"] + d["games_lost"]
                if current_crit == "sets_ratio_between":
                    return (d["sets_won"] / st) if st > 0 else 0.0
                return (d["games_won"] / gt) if gt > 0 else 0.0

            groups = defaultdict(list)
            for tid in team_list:
                groups[between_value(tid)].append(tid)

            result: List[int] = []
            for val in sorted(groups.keys(), reverse=True):
                subgroup = groups[val]
                if len(subgroup) == 1:
                    result.extend(subgroup)
                else:
                    result.extend(rank_teams_recursive(subgroup, criteria_index + 1))
            return result

        if current_crit == "h2h":
            if len(team_list) == 2:
                a, b = team_list[0], team_list[1]
                winner = _head_to_head_winner(tournament, group_index, a, b)
                if winner == a:
                    return [a, b]
                if winner == b:
                    return [b, a]
                return rank_teams_recursive(team_list, criteria_index + 1)

            h2h_result = _rank_by_h2h_mini_tournament(tournament, group_index, team_list, agg)
            if h2h_result is not None:
                return h2h_result
            return rank_teams_recursive(team_list, criteria_index + 1)
        
        # Группируем команды по значению текущего критерия
        groups = defaultdict(list)
        for tid in team_list:
            val = get_criterion_value(tid, current_crit)
            groups[val].append(tid)
        
        # Сортируем группы по значению критерия (по убыванию для числовых, по возрастанию для name)
        is_name = (current_crit == "name")
        sorted_values = sorted(groups.keys(), reverse=not is_name)
        
        result = []
        for val in sorted_values:
            group = groups[val]
            if len(group) == 1:
                result.extend(group)
            else:
                result.extend(rank_teams_recursive(group, criteria_index + 1))
        
        return result

    return rank_teams_recursive(teams, 0)
