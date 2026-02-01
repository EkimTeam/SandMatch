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
    """Возвращает словарь team_id -> агрегаты (wins, sets_won, sets_lost, sets_drawn, games_won, games_lost) по группе."""
    agg = defaultdict(lambda: {"wins": 0, "sets_won": 0, "sets_lost": 0, "sets_drawn": 0, "games_won": 0, "games_lost": 0})

    matches = (
        Match.objects.filter(tournament=tournament, stage=Match.Stage.GROUP, group_index=group_index)
        .prefetch_related("sets")
    )
    # Определим, является ли формат турнира режимом "только тай-брейк" или свободным форматом
    set_format = getattr(tournament, "set_format", None)
    only_tiebreak_mode = False
    is_free_format = False
    
    if set_format is not None:
        try:
            # Свободный формат: games_to == 0 и max_sets == 0
            is_free_format = (int(getattr(set_format, "games_to", 6)) == 0 and 
                            int(getattr(set_format, "max_sets", 1)) == 0)
            
            # Режим только тайбрейк
            only_tiebreak_mode = bool(getattr(set_format, "allow_tiebreak_only_set", False)) and int(getattr(set_format, "max_sets", 1)) == 1
        except Exception:
            only_tiebreak_mode = False
            is_free_format = False

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
                if is_free_format:
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
        if not is_free_format:
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
    is_free_format = False
    only_tiebreak_mode = False
    if set_format is not None:
        try:
            is_free_format = (
                int(getattr(set_format, "games_to", 6)) == 0
                and int(getattr(set_format, "max_sets", 1)) == 0
            )
            only_tiebreak_mode = bool(
                getattr(set_format, "allow_tiebreak_only_set", False)
            ) and int(getattr(set_format, "max_sets", 1)) == 1
        except Exception:
            is_free_format = False
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
            if is_free_format:
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

    Алгоритм ITF:
    1. Победы
    2. Личные встречи (мини-турнир)
    3. Разница сетов
    4. Личные встречи (мини-турнир)
    5. Разница геймов
    6. Личные встречи (мини-турнир)
    7. Финальные тай-брейкеры: спец. участник -> рейтинг -> алфавит
    """
    priority: List[str] = ["wins", "sets_ratio", "games_ratio"]

    # Предрасчёт вспомогательных величин и состав группы
    sets_ratio: Dict[int, float] = {}
    games_ratio: Dict[int, float] = {}
    name_by_team: Dict[int, str] = {}
    team_obj_by_id: Dict[int, any] = {}
    team_rating: Dict[int, float] = {}
    has_special: Dict[int, bool] = {}

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
        sets_ratio[team_id] = (d["sets_won"] / st) if st > 0 else 0.0
        games_ratio[team_id] = (d["games_won"] / gt) if gt > 0 else 0.0

        # Суммарный рейтинг команды (если поля rating нет — считаем 0)
        r1 = 0.0
        r2 = 0.0
        try:
            p1 = getattr(team, "player_1", None)
            p2 = getattr(team, "player_2", None)
            r1 = float(getattr(p1, "rating", 0) or 0)
            r2 = float(getattr(p2, "rating", 0) or 0)
        except Exception:
            r1 = r2 = 0.0
        # Для пар — среднее арифметическое, для одиночек — рейтинг игрока
        if p2:
            team_rating[team_id] = (r1 + r2) / 2.0
        else:
            team_rating[team_id] = r1

        # Специальный участник: если в команде есть игрок "Петров Михаил"
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
        has_special[team_id] = _is_special_player(getattr(team, "player_1", None)) or _is_special_player(getattr(team, "player_2", None))

    # Команды для ранжирования — именно участники группы, даже если у них пока нет матчей
    teams = [e.team_id for e in entries if e.team_id is not None]

    def get_criterion_value(team_id: int, crit: str):
        """Получить значение критерия для команды."""
        if crit == "wins":
            return agg[team_id]["wins"]
        elif crit == "sets_ratio":
            return sets_ratio.get(team_id, 0.0)
        elif crit == "games_ratio":
            return games_ratio.get(team_id, 0.0)
        elif crit == "name":
            return (name_by_team.get(team_id) or "").lower()
        return None

    def rank_teams_recursive(team_list: List[int], criteria_index: int) -> List[int]:
        """Рекурсивное ранжирование списка команд по критериям ITF."""
        if len(team_list) <= 1:
            return team_list
        if criteria_index >= len(priority):
            # Закончились критерии — применяем финальные тай-брейкеры: спец → рейтинг → имя
            return sorted(
                team_list,
                key=lambda tid: (
                    -int(has_special.get(tid, False)),
                    -float(team_rating.get(tid, 0.0)),
                    (name_by_team.get(tid) or "").lower(),
                )
            )

        current_crit = priority[criteria_index]
        
        # Группируем команды по значению текущего критерия
        from collections import defaultdict
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
            elif len(group) == 2:
                # Для пары применяем личную встречу
                a, b = group[0], group[1]
                winner = _head_to_head_winner(tournament, group_index, a, b)
                if winner == a:
                    result.extend([a, b])
                elif winner == b:
                    result.extend([b, a])
                else:
                    # Нет данных о личной встрече — переходим к следующему критерию
                    result.extend(rank_teams_recursive(group, criteria_index + 1))
            else:
                # Для 3+ участников: сначала пробуем мини-турнир по личным встречам (ITF)
                h2h_result = _rank_by_h2h_mini_tournament(tournament, group_index, group, agg)
                if h2h_result is not None:
                    # Личные встречи определили порядок
                    result.extend(h2h_result)
                else:
                    # Личные встречи не определили порядок — переходим к следующему критерию
                    result.extend(rank_teams_recursive(group, criteria_index + 1))
        
        return result

    return rank_teams_recursive(teams, 0)
