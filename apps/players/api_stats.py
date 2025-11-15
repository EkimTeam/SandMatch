from __future__ import annotations
from typing import Dict, Any, Set
from datetime import datetime
from django.http import JsonResponse, HttpRequest
from django.views.decorators.http import require_GET
from django.db.models import Q

from apps.players.models import Player
from apps.matches.models import Match, MatchSet
from apps.tournaments.models import Tournament


def _parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _date_filters(from_dt: datetime | None, to_dt: datetime | None) -> Q:
    q = Q()
    if from_dt:
        q &= Q(tournament__date__gte=from_dt.date())
    if to_dt:
        q &= Q(tournament__date__lte=to_dt.date())
    return q


@require_GET
def summary_stats(request: HttpRequest) -> JsonResponse:
    d_from = _parse_date(request.GET.get('from'))
    d_to = _parse_date(request.GET.get('to'))

    match_q = Q(status=Match.Status.COMPLETED) & _date_filters(d_from, d_to)

    # Общая статистика
    matches_qs = Match.objects.filter(match_q)
    total_matches = matches_qs.count()

    # игроки с матчами
    player_ids: Set[int] = set()
    for m in matches_qs.select_related('team_1', 'team_2').only('team_1_id', 'team_2_id'):
        if m.team_1:
            if m.team_1.player_1_id:
                player_ids.add(m.team_1.player_1_id)
            if m.team_1.player_2_id:
                player_ids.add(m.team_1.player_2_id)
        if m.team_2:
            if m.team_2.player_1_id:
                player_ids.add(m.team_2.player_1_id)
            if m.team_2.player_2_id:
                player_ids.add(m.team_2.player_2_id)
    total_players_with_matches = len(player_ids)
    avg_matches_per_player = (total_matches / total_players_with_matches) if total_players_with_matches > 0 else 0

    # средний процент побед как среднее по игрокам
    # посчитаем wins/matches для каждого игрока
    wins_map: Dict[int, int] = {pid: 0 for pid in player_ids}
    matches_map: Dict[int, int] = {pid: 0 for pid in player_ids}
    for m in matches_qs.select_related('team_1', 'team_2'):
        t1 = m.team_1
        t2 = m.team_2
        ids1 = [t1.player_1_id, t1.player_2_id] if t1 else []
        ids2 = [t2.player_1_id, t2.player_2_id] if t2 else []
        for pid in ids1 + ids2:
            if pid:
                matches_map[pid] = matches_map.get(pid, 0) + 1
        if m.winner_id and t1 and t2:
            if m.winner_id == getattr(m, 'team_1_id', None):
                for pid in ids1:
                    if pid:
                        wins_map[pid] = wins_map.get(pid, 0) + 1
            elif m.winner_id == getattr(m, 'team_2_id', None):
                for pid in ids2:
                    if pid:
                        wins_map[pid] = wins_map.get(pid, 0) + 1
    winrates = []
    for pid in player_ids:
        mm = matches_map.get(pid, 0)
        if mm > 0:
            winrates.append(100.0 * wins_map.get(pid, 0) / mm)
    avg_winrate = round(sum(winrates) / len(winrates), 1) if winrates else 0.0

    # Статистика по типам турниров
    t_q = Q()
    if d_from:
        t_q &= Q(date__gte=d_from.date())
    if d_to:
        t_q &= Q(date__lte=d_to.date())
    hard_tournaments = Tournament.objects.filter(t_q & Q(name__icontains='HARD')).count()
    medium_tournaments = Tournament.objects.filter(t_q & Q(name__icontains='MEDIUM')).count()
    other_tournaments = Tournament.objects.filter(t_q & ~Q(name__icontains='HARD') & ~Q(name__icontains='MEDIUM')).count()
    # турниры только тай-брейк: определяем по формату турнира (set_format_id=4)
    # учитываем фильтр по датам
    tiebreak_tournaments = Tournament.objects.filter(t_q & Q(set_format_id=4)).count()

    # Распределение игроков по типам турниров (по участию в матчах)
    hard_players: Set[int] = set()
    medium_players: Set[int] = set()
    typed_match_qs = Match.objects.filter(match_q & (Q(tournament__name__icontains='HARD') | Q(tournament__name__icontains='MEDIUM'))).select_related('team_1', 'team_2')
    for m in typed_match_qs:
        ids1 = [m.team_1.player_1_id, m.team_1.player_2_id] if m.team_1 else []
        ids2 = [m.team_2.player_1_id, m.team_2.player_2_id] if m.team_2 else []
        group = 'HARD' if 'HARD' in (m.tournament.name or '').upper() else ('MEDIUM' if 'MEDIUM' in (m.tournament.name or '').upper() else None)
        if group == 'HARD':
            for pid in ids1 + ids2:
                if pid:
                    hard_players.add(pid)
        elif group == 'MEDIUM':
            for pid in ids1 + ids2:
                if pid:
                    medium_players.add(pid)
    only_hard = len(hard_players - medium_players)
    only_medium = len(medium_players - hard_players)
    both_types = len(hard_players & medium_players)
    without_typed = len(set(player_ids) - (hard_players | medium_players))

    # Табличные данные по игрокам
    # Собираем статистику за период
    player_stats: Dict[int, Dict[str, Any]] = {}
    for m in matches_qs.select_related('team_1', 'team_2'):
        ids1 = [m.team_1.player_1_id, m.team_1.player_2_id] if m.team_1 else []
        ids2 = [m.team_2.player_1_id, m.team_2.player_2_id] if m.team_2 else []
        for pid in (pid for pid in ids1 + ids2 if pid):
            ps = player_stats.setdefault(pid, {
                'matches': 0,
                'wins': 0,
                'losses': 0,
                'tournaments': set(),
                'partners': set(),
                'opponents': set(),
            })
            ps['matches'] += 1
            if pid in ids1:
                ps['partners'].update([x for x in ids1 if x and x != pid])
                ps['opponents'].update([x for x in ids2 if x])
            else:
                ps['partners'].update([x for x in ids2 if x and x != pid])
                ps['opponents'].update([x for x in ids1 if x])
            ps['tournaments'].add(m.tournament_id)
        if m.winner_id and m.team_1 and m.team_2:
            win_ids = ids1 if m.winner_id == getattr(m, 'team_1_id', None) else ids2
            lose_ids = ids2 if win_ids is ids1 else ids1
            for pid in win_ids:
                if pid:
                    player_stats[pid]['wins'] += 1
            for pid in lose_ids:
                if pid:
                    player_stats[pid]['losses'] += 1

    # Сформируем массив для таблиц с необходимыми полями
    rows: list[Dict[str, Any]] = []
    players_map = {p.id: p for p in Player.objects.filter(id__in=player_stats.keys()).only('id', 'first_name', 'last_name', 'display_name')}
    for pid, ps in player_stats.items():
        matches_cnt = ps['matches']
        wins_cnt = ps['wins']
        losses_cnt = ps['losses']
        winrate = round(100.0 * wins_cnt / matches_cnt, 1) if matches_cnt > 0 else 0.0
        p = players_map.get(pid)
        rows.append({
            'id': pid,
            'first_name': getattr(p, 'first_name', ''),
            'last_name': getattr(p, 'last_name', ''),
            'display_name': getattr(p, 'display_name', ''),
            'tournaments_count': len(ps['tournaments']),
            'matches_count': matches_cnt,
            'wins': wins_cnt,
            'losses': losses_cnt,
            'winrate': winrate,
            'unique_partners': len(ps['partners']),
            'unique_opponents': len(ps['opponents']),
        })

    # Таблицы
    top20_by_winrate = sorted(rows, key=lambda r: (-r['winrate'], -r['matches_count']))[:20]
    successful_10_min = [r for r in rows if r['matches_count'] >= 10]
    top_successful = sorted(successful_10_min, key=lambda r: (-r['winrate'], -r['matches_count']))[:20]
    top_active = sorted(rows, key=lambda r: (-r['matches_count'], -r['winrate']))[:20]
    top_partners = sorted(rows, key=lambda r: (-r['unique_partners'], -r['matches_count']))[:20]

    return JsonResponse({
        'period': {
            'from': request.GET.get('from') or None,
            'to': request.GET.get('to') or None,
        },
        'overall': {
            'players_with_matches': total_players_with_matches,
            'matches': total_matches,
            'avg_matches_per_player': round(avg_matches_per_player, 2),
            'avg_winrate': avg_winrate,
        },
        'by_tournament_types': {
            'hard_tournaments': hard_tournaments,
            'medium_tournaments': medium_tournaments,
            'other_tournaments': other_tournaments,
            'tiebreak_only_tournaments': tiebreak_tournaments,
        },
        'players_distribution_by_types': {
            'only_hard': only_hard,
            'only_medium': only_medium,
            'both': both_types,
            'without_typed': without_typed,
        },
        'tables': {
            'top20_by_winrate': top20_by_winrate,
            'top_successful_min10': top_successful,
            'top_active': top_active,
            'top_partners': top_partners,
        }
    })
