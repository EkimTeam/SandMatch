"""
Расчёт статистики и ранжирования для турниров системы King.
Портировано с frontend/src/utils/kingRanking.ts для единообразия с круговой системой.
"""
from typing import Dict, List, Set, Tuple, Optional, Any
from collections import defaultdict
from apps.tournaments.models import Tournament, TournamentEntry
from apps.matches.models import Match


def _aggregate_for_king_group(
    tournament: Tournament,
    group_index: int,
    group_data: dict,
) -> Dict[int, dict]:
    """
    Возвращает словарь row_index -> агрегаты для группы King.
    Вычисляет статистику для всех трёх режимов (NO, G-, M+) одновременно.
    
    Args:
        tournament: Турнир
        group_index: Индекс группы
        group_data: Данные группы из king_schedule (rounds, participants)
    
    Returns:
        {
            row_index: {
                # Режим NO (все матчи)
                'wins': int,
                'sets_won': int,
                'sets_lost': int,
                'games_won': int,
                'games_lost': int,
                'games_ratio': float,
                'sets_ratio_value': float,
                
                # Режим G- (только до min_matches)
                'wins_g': int,
                'sets_won_g': int,
                'sets_lost_g': int,
                'games_won_g': int,
                'games_lost_g': int,
                'games_ratio_g': float,
                'sets_ratio_value_g': float,
                
                # Режим M+ (с компенсацией за недоигранные матчи)
                'wins_m': int,  # всегда 0
                'sets_won_m': int,
                'sets_lost_m': int,
                'games_won_m': int,
                'games_lost_m': int,
                'games_ratio_m': float,
                'sets_ratio_value_m': float,
                
                'points_by_round': List[Optional[int]],  # для отладки
            }
        }
    """
    schedule_rounds = group_data.get('rounds', [])
    all_matches_data = []
    for r in schedule_rounds:
        all_matches_data.extend(r.get('matches', []))
    
    # Получаем реальные объекты Match из БД для доступа к sets
    match_ids = [m['id'] for m in all_matches_data if 'id' in m]
    matches_qs = Match.objects.filter(id__in=match_ids).prefetch_related('sets')
    matches_by_id = {m.id: m for m in matches_qs}
    
    # Маппинг player_id -> row_index
    player_to_row = {}
    for pt in group_data.get('participants', []):
        team = pt.get('team', {})
        if isinstance(team.get('players'), list):
            for pl in team['players']:
                if pl and pl.get('id'):
                    player_to_row[int(pl['id'])] = pt['row_index']
        else:
            if team.get('player_1'):
                player_to_row[int(team['player_1'])] = pt['row_index']
            if team.get('player_2'):
                player_to_row[int(team['player_2'])] = pt['row_index']
    
    def compute_stats_for_row(
        row_index: int,
        subset_rows: Optional[Set[int]] = None,
        raw_between: bool = False
    ) -> dict:
        """Подсчёт статистики для одного участника"""
        # Получаем player_id участника из group_data.participants по row_index.
        # Для King турниров: участник имеет team_id, где player_1_id - реальный игрок, player_2_id = NULL.
        # В матчах этот игрок может быть в паре с кем угодно, в любой позиции.
        my_player_id = None
        for pt in group_data.get('participants', []):
            if pt.get('row_index') != row_index:
                continue
            team = pt.get('team', {}) or {}
            # Берём только player_1, т.к. это единственный реальный игрок участника
            if team.get('player_1') is not None:
                my_player_id = int(team['player_1'])
            break

        if not my_player_id:
            return {
                'wins': 0, 'sets_won': 0, 'sets_lost': 0,
                'games_won': 0, 'games_lost': 0,
                'games_ratio': 0, 'sets_ratio_value': 0,
                'points_by_round': []
            }
        
        my_per_round = []
        op_per_round = []
        wins_per_round = []  # Храним победы по раундам для последующей фильтрации
        sets_won_per_round = []  # Храним выигранные сеты по раундам
        sets_lost_per_round = []  # Храним проигранные сеты по раундам
        
        for r_idx, round_data in enumerate(schedule_rounds):
            sms = round_data.get('matches', [])
            # Найти матч, в котором участвует мой игрок (my_player_id)
            sched_match = None
            i_am_team1 = None
            for sm in sms:
                team1_players = sm.get('team1_players', [])
                team2_players = sm.get('team2_players', [])
                # Проверяем, есть ли мой игрок в team1 или team2
                in_team1 = any(p.get('id') == my_player_id for p in team1_players if p)
                in_team2 = any(p.get('id') == my_player_id for p in team2_players if p)
                if in_team1:
                    sched_match = sm
                    i_am_team1 = True
                    break
                elif in_team2:
                    sched_match = sm
                    i_am_team1 = False
                    break
            
            if not sched_match:
                my_per_round.append(None)
                op_per_round.append(None)
                wins_per_round.append(None)
                sets_won_per_round.append(None)
                sets_lost_per_round.append(None)
                continue
            
            # Если считаем для подмножества (личные встречи), проверяем соперника
            if subset_rows and len(subset_rows) > 0:
                team1_players = sched_match.get('team1_players', [])
                team2_players = sched_match.get('team2_players', [])
                opp_team = team2_players if i_am_team1 else team1_players
                opp_has_in_subset = any(
                    player_to_row.get(p.get('id'), -1) in subset_rows
                    for p in opp_team if p
                )
                self_in_subset = row_index in subset_rows
                if not (self_in_subset and opp_has_in_subset):
                    my_per_round.append(None)
                    op_per_round.append(None)
                    wins_per_round.append(None)
                    sets_won_per_round.append(None)
                    sets_lost_per_round.append(None)
                    continue
            
            # Получаем полный матч с сетами из БД
            match_id = sched_match.get('id')
            full_match = matches_by_id.get(match_id) if match_id else None
            if not full_match:
                my_per_round.append(None)
                op_per_round.append(None)
                wins_per_round.append(None)
                sets_won_per_round.append(None)
                sets_lost_per_round.append(None)
                continue
            
            sets = list(full_match.sets.all().order_by('index'))
            if not sets:
                my_per_round.append(None)
                op_per_round.append(None)
                wins_per_round.append(None)
                sets_won_per_round.append(None)
                sets_lost_per_round.append(None)
                continue
            
            # i_am_team1 уже определено выше при поиске матча
            total_sets = len(sets)
            only_tb = total_sets == 1 and sets[0].is_tiebreak_only
            
            my = 0
            op = 0
            had_any_set = False
            m_sets_my = 0
            m_sets_op = 0
            
            for s in sets:
                is_tb_only = s.is_tiebreak_only
                has_tb = s.tb_1 is not None or s.tb_2 is not None
                idx = s.index
                
                if is_tb_only:
                    had_any_set = True
                    t1 = s.tb_1 or 0
                    t2 = s.tb_2 or 0
                    if only_tb:
                        # Матч состоит только из тайбрейка: считаем tb как геймы
                        a = t1 if i_am_team1 else t2
                        b = t2 if i_am_team1 else t1
                        my += a
                        op += b
                    else:
                        # Тайбрейк-only как отдельный сет: 1:0/0:1
                        a = 1 if (i_am_team1 and t1 > t2) or (not i_am_team1 and t2 > t1) else 0
                        b = 1 if (i_am_team1 and t2 > t1) or (not i_am_team1 and t1 > t2) else 0
                        my += a
                        op += b
                    
                    if t1 > t2:
                        if i_am_team1:
                            m_sets_my += 1
                        else:
                            m_sets_op += 1
                    elif t2 > t1:
                        if i_am_team1:
                            m_sets_op += 1
                        else:
                            m_sets_my += 1
                
                elif has_tb and idx == 3:
                    # Чемпионский тайбрейк в 3-м сете
                    had_any_set = True
                    t1 = s.tb_1 or 0
                    t2 = s.tb_2 or 0
                    a = 1 if (i_am_team1 and t1 > t2) or (not i_am_team1 and t2 > t1) else 0
                    b = 1 if (i_am_team1 and t2 > t1) or (not i_am_team1 and t1 > t2) else 0
                    my += a
                    op += b
                    if a > b:
                        m_sets_my += 1
                    elif b > a:
                        m_sets_op += 1
                
                else:
                    # Обычный сет
                    g1 = s.games_1 or 0
                    g2 = s.games_2 or 0
                    if g1 != 0 or g2 != 0:
                        had_any_set = True
                    a = g1 if i_am_team1 else g2
                    b = g2 if i_am_team1 else g1
                    my += a
                    op += b
                    if g1 > g2:
                        if i_am_team1:
                            m_sets_my += 1
                        else:
                            m_sets_op += 1
                    elif g2 > g1:
                        if i_am_team1:
                            m_sets_op += 1
                        else:
                            m_sets_my += 1
            
            if not had_any_set:
                my_per_round.append(None)
                op_per_round.append(None)
                wins_per_round.append(None)
                sets_won_per_round.append(None)
                sets_lost_per_round.append(None)
                continue
            
            my_per_round.append(my)
            op_per_round.append(op)
            
            # Сохраняем информацию о победе и сетах в этом раунде
            match_won = 1 if m_sets_my > m_sets_op else 0
            wins_per_round.append(match_won)
            sets_won_per_round.append(m_sets_my)
            sets_lost_per_round.append(m_sets_op)
        
        # Подсчёт количества матчей для каждого участника группы (для G-/M+)
        indices = [i for i, v in enumerate(my_per_round) if v is not None]
        
        counts_across = []
        for pt2 in group_data.get('participants', []):
            # Если считаем для подмножества, учитываем только участников из него
            if subset_rows and len(subset_rows) > 0:
                if pt2['row_index'] not in subset_rows:
                    continue
            
            # Получаем идентификаторы игроков участника pt2
            ids2 = set()
            team2 = pt2.get('team', {}) or {}
            players_list = team2.get('players')
            if isinstance(players_list, list):
                for pl in players_list:
                    if pl and pl.get('id') is not None:
                        try:
                            ids2.add(int(pl['id']))
                        except Exception:
                            pass
            else:
                if team2.get('player_1') is not None:
                    try:
                        ids2.add(int(team2['player_1']))
                    except Exception:
                        pass
                if team2.get('player_2') is not None:
                    try:
                        ids2.add(int(team2['player_2']))
                    except Exception:
                        pass
            c = 0
            for r in schedule_rounds:
                sms = r.get('matches', [])
                has = False
                for sm in sms:
                    team1_players = sm.get('team1_players', [])
                    team2_players = sm.get('team2_players', [])
                    in_t1 = any(p.get('id') in ids2 for p in team1_players if p)
                    in_t2 = any(p.get('id') in ids2 for p in team2_players if p)
                    if not (in_t1 or in_t2):
                        continue
                    
                    if subset_rows and len(subset_rows) > 0:
                        opp_team = team2_players if in_t1 else team1_players
                        opp_has_in_subset = any(
                            player_to_row.get(p.get('id'), -1) in subset_rows
                            for p in opp_team if p
                        )
                        if not opp_has_in_subset:
                            continue
                    
                    has = True
                    break
                if has:
                    c += 1
            counts_across.append(c)
        
        min_matches = min(counts_across) if counts_across else 0
        max_matches = max(counts_across) if counts_across else 0
        
        # Вычисляем статистику для всех трёх режимов одновременно
        
        # === Режим NO (все матчи) ===
        take_no = indices
        wins_no = sum(wins_per_round[i] for i in take_no if wins_per_round[i] is not None)
        sets_won_no = sum(sets_won_per_round[i] for i in take_no if sets_won_per_round[i] is not None)
        sets_lost_no = sum(sets_lost_per_round[i] for i in take_no if sets_lost_per_round[i] is not None)
        games_won_no = sum(my_per_round[i] for i in take_no if my_per_round[i] is not None)
        games_lost_no = sum(op_per_round[i] for i in take_no if op_per_round[i] is not None)
        games_ratio_no = games_won_no / (games_won_no + games_lost_no) if (games_won_no + games_lost_no) > 0 else 0
        sets_ratio_no = sets_won_no / (sets_won_no + sets_lost_no) if (sets_won_no + sets_lost_no) > 0 else 0
        
        # === Режим G- (только до min_matches) ===
        take_g = indices[:min_matches] if not raw_between else indices
        wins_g = sum(wins_per_round[i] for i in take_g if wins_per_round[i] is not None)
        sets_won_g = sum(sets_won_per_round[i] for i in take_g if sets_won_per_round[i] is not None)
        sets_lost_g = sum(sets_lost_per_round[i] for i in take_g if sets_lost_per_round[i] is not None)
        games_won_g = sum(my_per_round[i] for i in take_g if my_per_round[i] is not None)
        games_lost_g = sum(op_per_round[i] for i in take_g if op_per_round[i] is not None)
        games_ratio_g = games_won_g / (games_won_g + games_lost_g) if (games_won_g + games_lost_g) > 0 else 0
        sets_ratio_g = sets_won_g / (sets_won_g + sets_lost_g) if (sets_won_g + sets_lost_g) > 0 else 0
        
        # === Режим M+ (с компенсацией за недоигранные матчи) ===
        if raw_between:
            # Для личных встреч M+ не применяется
            wins_m = wins_no
            sets_won_m = sets_won_no
            sets_lost_m = sets_lost_no
            games_won_m = games_won_no
            games_lost_m = games_lost_no
            games_ratio_m = games_ratio_no
            sets_ratio_m = sets_ratio_no
        else:
            wins_m = 0  # Для M+ победы всегда 0
            played = len(indices)
            avg = round(games_won_no / played) if played > 0 else 0
            add = max(0, max_matches - played) * avg
            games_won_m = games_won_no + add
            games_lost_m = games_lost_no
            # Для M+ сравнение по "соот." осуществляется по абсолютам
            games_ratio_m = games_won_m  # абсолютное значение
            sets_ratio_m = sets_won_no  # абсолютное значение
            sets_won_m = sets_won_no
            sets_lost_m = sets_lost_no
        
        return {
            # Режим NO
            'wins': wins_no,
            'sets_won': sets_won_no,
            'sets_lost': sets_lost_no,
            'games_won': games_won_no,
            'games_lost': games_lost_no,
            'games_ratio': games_ratio_no,
            'sets_ratio_value': sets_ratio_no,
            
            # Режим G-
            'wins_g': wins_g,
            'sets_won_g': sets_won_g,
            'sets_lost_g': sets_lost_g,
            'games_won_g': games_won_g,
            'games_lost_g': games_lost_g,
            'games_ratio_g': games_ratio_g,
            'sets_ratio_value_g': sets_ratio_g,
            
            # Режим M+
            'wins_m': wins_m,
            'sets_won_m': sets_won_m,
            'sets_lost_m': sets_lost_m,
            'games_won_m': games_won_m,
            'games_lost_m': games_lost_m,
            'games_ratio_m': games_ratio_m,
            'sets_ratio_value_m': sets_ratio_m,
            
            'points_by_round': my_per_round,
        }
    
    # Собираем агрегаты для всех участников группы
    result: Dict[int, dict] = {}
    for pt in group_data.get('participants', []):
        row_index = pt.get('row_index')
        if row_index is None:
            continue
        result[int(row_index)] = compute_stats_for_row(int(row_index))

    # Возвращаем результат и функцию для пересчёта тай-брейков
    return result, compute_stats_for_row


def compute_king_group_ranking(
    tournament: Tournament,
    group_index: int,
    calculation_mode: str,
    group_data: dict,
    stats: Dict[int, dict],
    compute_stats_for_subset_fn=None,
) -> Dict[int, int]:
    """
    Возвращает словарь row_index -> rank для группы King.
    
    Args:
        tournament: Турнир
        group_index: Индекс группы
        calculation_mode: 'g_minus', 'm_plus' или 'no'
        group_data: Данные группы из king_schedule
        stats: Агрегаты, полученные из _aggregate_for_king_group
        compute_stats_for_subset_fn: Функция для пересчёта статистики для подмножества (тай-брейки)
    
    Returns:
        {row_index: rank}
    """
    ruleset = tournament.ruleset
    if ruleset and ruleset.ordering_priority:
        ordering = list(ruleset.ordering_priority)
    else:
        ordering = ['wins', 'sets_fraction', 'games_ratio', 'name_asc']
    
    if 'name_asc' not in ordering:
        ordering.append('name_asc')
    
    # Маппинг player_id -> row_index (для личных встреч)
    player_to_row = {}
    for pt in group_data.get('participants', []):
        team = pt.get('team', {})
        if isinstance(team.get('players'), list):
            for pl in team['players']:
                if pl and pl.get('id'):
                    player_to_row[int(pl['id'])] = pt['row_index']
        else:
            if team.get('player_1'):
                player_to_row[int(team['player_1'])] = pt['row_index']
            if team.get('player_2'):
                player_to_row[int(team['player_2'])] = pt['row_index']
    
    def get_val(obj: dict, key: str) -> float:
        """Получить значение критерия для сравнения"""
        # Определяем суффикс в зависимости от режима
        suffix = ''
        if calculation_mode == 'g_minus':
            suffix = '_g'
        elif calculation_mode == 'm_plus':
            suffix = '_m'
        
        if key == 'wins':
            return obj.get(f'wins{suffix}', 0)
        if key in ('sets_fraction', 'sets_ratio', 'sets_ratio_all'):
            if f'sets_ratio_value{suffix}' in obj:
                return obj[f'sets_ratio_value{suffix}']
            sw = obj.get(f'sets_won{suffix}', 0)
            sl = obj.get(f'sets_lost{suffix}', 0)
            return sw / (sw + sl) if (sw + sl) > 0 else 0
        if key in ('games_ratio', 'games_ratio_all'):
            return obj.get(f'games_ratio{suffix}', 0)
        if key == 'games_diff':
            return obj.get(f'games_won{suffix}', 0) - obj.get(f'games_lost{suffix}', 0)
        if key == 'sets_diff':
            return obj.get(f'sets_won{suffix}', 0) - obj.get(f'sets_lost{suffix}', 0)
        return 0
    
    # Функция compute_stats_for_subset теперь передаётся как параметр
    # (используется compute_stats_for_row из _aggregate_for_king_group)
    
    def compare_with_criteria(a: dict, b: dict, subset: Optional[Set[int]] = None) -> int:
        """Сравнить двух участников по критериям ordering"""
        for rule_raw in ordering:
            rule = str(rule_raw)
            
            # Личные встречи
            if rule in ('h2', 'head_to_head') or rule.endswith('_h2h'):
                tied_rows = subset if subset else {a['row_index'], b['row_index']}
                sa = compute_stats_for_subset_fn(a['row_index'], tied_rows, raw_between=True) if compute_stats_for_subset_fn else {}
                sb = compute_stats_for_subset_fn(b['row_index'], tied_rows, raw_between=True) if compute_stats_for_subset_fn else {}
                va = get_val(sa, 'wins')
                vb = get_val(sb, 'wins')
                if va != vb:
                    return -1 if vb > va else 1
                continue
            
            # Между собой: *_between
            if rule in ('sets_ratio_between', 'games_ratio_between'):
                tied_rows = subset if subset else {a['row_index'], b['row_index']}
                sa = compute_stats_for_subset_fn(a['row_index'], tied_rows, raw_between=True) if compute_stats_for_subset_fn else {}
                sb = compute_stats_for_subset_fn(b['row_index'], tied_rows, raw_between=True) if compute_stats_for_subset_fn else {}
                key = 'sets_ratio' if rule.startswith('sets_') else 'games_ratio'
                va = get_val(sa, key)
                vb = get_val(sb, key)
                if va != vb:
                    return -1 if vb > va else 1
                continue
            
            va = get_val(a['base'], rule)
            vb = get_val(b['base'], rule)
            if va != vb:
                return -1 if vb > va else 1
            
            if rule == 'name_asc':
                an = a.get('display_name') or a.get('name') or ''
                bn = b.get('display_name') or b.get('name') or ''
                cmp = (an > bn) - (an < bn)
                if cmp != 0:
                    return cmp
        
        return 0
    
    # Подготовка списка участников для сортировки
    items = []
    for pt in group_data.get('participants', []):
        row_index = pt['row_index']
        items.append({
            'pt': pt,
            'row_index': row_index,
            'base': stats.get(row_index, {}),
            'display_name': pt.get('display_name'),
            'name': pt.get('name'),
        })
    
    # Сортировка
    from functools import cmp_to_key
    items.sort(key=cmp_to_key(lambda a, b: compare_with_criteria(a, b)))
    
    # Присвоение рангов
    rank_map = {}
    cur_rank = 1
    for i, item in enumerate(items):
        if i > 0 and compare_with_criteria(items[i-1], item) != 0:
            cur_rank = i + 1
        rank_map[item['row_index']] = cur_rank
    
    return rank_map


def recalc_king_group_stats(
    tournament: Tournament,
    group_index: int,
    group_data: dict,
) -> int:
    """
    Пересчитывает и сохраняет статистику для группы King.
    
    Args:
        tournament: Турнир
        group_index: Индекс группы
        group_data: Данные группы из king_schedule
    
    Returns:
        Количество обновлённых записей
    """
    calculation_mode = getattr(tournament, 'king_calculation_mode', 'no') or 'no'
    
    # Рассчитываем агрегаты для всех трёх режимов
    stats, compute_stats_fn = _aggregate_for_king_group(tournament, group_index, group_data)
    
    # Рассчитываем ранжирование для текущего режима
    placements = compute_king_group_ranking(
        tournament, group_index, calculation_mode, group_data, stats, compute_stats_fn
    )
    
    # Сохраняем в БД (используем TournamentEntryStats или создаём новую модель)
    # Пока просто возвращаем количество
    # TODO: реализовать сохранение в БД
    
    return len(stats)
