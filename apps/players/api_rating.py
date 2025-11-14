from __future__ import annotations
from typing import Any, Dict, List
from django.http import JsonResponse, HttpRequest
from django.views.decorators.http import require_GET
from django.db.models import Count, Q
from apps.players.models import Player, PlayerRatingDynamic
from apps.matches.models import Match, MatchSet


def _match_base_q(player_id: int, hard: bool, medium: bool, tbo: bool):
    q = Q(
        Q(team_1__player_1_id=player_id) |
        Q(team_1__player_2_id=player_id) |
        Q(team_2__player_1_id=player_id) |
        Q(team_2__player_2_id=player_id)
    )
    if hard and not medium:
        q &= Q(tournament__name__icontains='HARD')
    if medium and not hard:
        q &= Q(tournament__name__icontains='MEDIUM')
    if tbo:
        q &= Q(sets__is_tiebreak_only=True)
    return q


def _match_score_str(match_id: int, flip: bool = False) -> str:
    sets = list(MatchSet.objects.filter(match_id=match_id).order_by('index'))
    if not sets:
        return ''
    parts: List[str] = []
    for s in sets:
        if s.is_tiebreak_only:
            if s.tb_1 is not None and s.tb_2 is not None:
                if flip:
                    parts.append(f"TB({s.tb_2}:{s.tb_1})")
                else:
                    parts.append(f"TB({s.tb_1}:{s.tb_2})")
            else:
                parts.append("TB")
        else:
            if flip:
                base = f"{s.games_2}:{s.games_1}"
            else:
                base = f"{s.games_1}:{s.games_2}"
            if (s.tb_1 is not None) and (s.tb_2 is not None):
                if flip:
                    base += f"({s.tb_2}:{s.tb_1})"
                else:
                    base += f"({s.tb_1}:{s.tb_2})"
            parts.append(base)
    return ', '.join(parts)


def _opponent_name(m: Match, player_id: int) -> str:
    # Определяем id игроков соперника
    t1 = m.team_1
    t2 = m.team_2
    in_team1 = t1 and (t1.player_1_id == player_id or t1.player_2_id == player_id)
    opp_ids: List[int] = []
    if in_team1 and t2:
        if t2.player_1_id:
            opp_ids.append(t2.player_1_id)
        if t2.player_2_id:
            opp_ids.append(t2.player_2_id)
    elif (not in_team1) and t1:
        if t1.player_1_id:
            opp_ids.append(t1.player_1_id)
        if t1.player_2_id:
            opp_ids.append(t1.player_2_id)
    players = list(Player.objects.filter(id__in=opp_ids).values('display_name', 'last_name'))
    if not players:
        return ''
    names = [f"{p['display_name']} {p['last_name']}".strip() for p in players]
    return ' vs '.join(names)


def _opponent_ids(m: Match, player_id: int) -> list[int]:
    t1 = m.team_1
    t2 = m.team_2
    in_team1 = t1 and (t1.player_1_id == player_id or t1.player_2_id == player_id)
    opp_ids: list[int] = []
    if in_team1 and t2:
        if t2.player_1_id:
            opp_ids.append(t2.player_1_id)
        if t2.player_2_id:
            opp_ids.append(t2.player_2_id)
    elif (not in_team1) and t1:
        if t1.player_1_id:
            opp_ids.append(t1.player_1_id)
        if t1.player_2_id:
            opp_ids.append(t1.player_2_id)
    return opp_ids


def _partner_name(m: Match, player_id: int) -> str:
    t1 = m.team_1
    t2 = m.team_2
    in_team1 = t1 and (t1.player_1_id == player_id or t1.player_2_id == player_id)
    partner_id = None
    if in_team1 and t1:
        ids = [t1.player_1_id, t1.player_2_id]
        ids = [pid for pid in ids if pid and pid != player_id]
        partner_id = ids[0] if ids else None
    elif (not in_team1) and t2:
        ids = [t2.player_1_id, t2.player_2_id]
        ids = [pid for pid in ids if pid and pid != player_id]
        partner_id = ids[0] if ids else None
    if not partner_id:
        return ''
    p = Player.objects.filter(id=partner_id).values('display_name', 'last_name').first()
    if not p:
        return ''
    return f"{p['display_name']} {p['last_name']}".strip()


def _last5_badges(player_id: int, hard: bool, medium: bool, tbo: bool) -> List[Dict[str, Any]]:
    qs = list(
        Match.objects
        .filter(_match_base_q(player_id, hard, medium, tbo), status=Match.Status.COMPLETED)
        .select_related('tournament', 'team_1', 'team_2')
        .order_by('-tournament__date', '-finished_at', '-id')[:5]
    )
    # Вернём в порядке от более старой игры к более новой,
    # чтобы крайний правый кружок был самой последней игрой
    qs.reverse()
    result: List[Dict[str, Any]] = []
    for m in qs:
        # Для завершённых матчей winner_id гарантирован
        in_team1 = (m.team_1 and (m.team_1.player_1_id == player_id or m.team_1.player_2_id == player_id))
        in_team2 = (m.team_2 and (m.team_2.player_1_id == player_id or m.team_2.player_2_id == player_id))
        won = (in_team1 and m.winner_id == getattr(m, 'team_1_id', None)) or (in_team2 and m.winner_id == getattr(m, 'team_2_id', None))
        res = 'W' if won else 'L'
        flip = (res == 'L')
        result.append({
            'match_id': m.id,
            'result': res,
            'tournament_id': m.tournament_id,
            'tournament_name': getattr(m.tournament, 'name', ''),
            'tournament_date': str(getattr(m.tournament, 'date', '') or ''),
            'opponent': _opponent_name(m, player_id),
            'partner': _partner_name(m, player_id),
            'score': _match_score_str(m.id, flip=flip),
        })
    return result


def _matches_count(player_id: int, hard: bool, medium: bool, tbo: bool) -> int:
    return Match.objects.filter(_match_base_q(player_id, hard, medium, tbo)).count()


def _wins_count(player_id: int, hard: bool, medium: bool, tbo: bool) -> int:
    qs = Match.objects.filter(_match_base_q(player_id, hard, medium, tbo), status=Match.Status.COMPLETED).select_related('team_1', 'team_2')
    wins = 0
    for m in qs:
        in_team1 = (m.team_1 and (m.team_1.player_1_id == player_id or m.team_1.player_2_id == player_id))
        in_team2 = (m.team_2 and (m.team_2.player_1_id == player_id or m.team_2.player_2_id == player_id))
        if (in_team1 and m.winner_id == getattr(m, 'team_1_id', None)) or (in_team2 and m.winner_id == getattr(m, 'team_2_id', None)):
            wins += 1
    return wins


def _tournaments_count(player_id: int, hard: bool, medium: bool, tbo: bool) -> int:
    return (
        Match.objects
        .filter(_match_base_q(player_id, hard, medium, tbo), status=Match.Status.COMPLETED)
        .values('tournament_id')
        .distinct()
        .count()
    )


@require_GET
def leaderboard(request: HttpRequest) -> JsonResponse:
    # Параметры
    hard = request.GET.get('hard') in ('1', 'true', 'True')
    medium = request.GET.get('medium') in ('1', 'true', 'True')
    tbo = request.GET.get('tiebreak_only') in ('1', 'true', 'True')
    q = (request.GET.get('q') or '').strip()
    try:
        page = max(1, int(request.GET.get('page') or '1'))
    except ValueError:
        page = 1
    try:
        page_size = max(1, int(request.GET.get('page_size') or '20'))
    except ValueError:
        page_size = 20

    players_qs = Player.objects.all()
    if q:
        players_qs = players_qs.filter(
            Q(display_name__icontains=q) |
            Q(first_name__icontains=q) |
            Q(last_name__icontains=q)
        )
    total = players_qs.count()
    total_pages = (total + page_size - 1) // page_size
    players = players_qs.order_by('-current_rating')[(page - 1) * page_size: page * page_size]

    data = []
    for p in players:
        matches = _matches_count(p.id, hard, medium, tbo)
        wins = _wins_count(p.id, hard, medium, tbo)
        winrate = round((wins * 100.0 / matches), 1) if matches > 0 else 0.0
        last5 = _last5_badges(p.id, hard, medium, tbo)
        # Позиция в общем рейтинге (dense rank по current_rating)
        rank = Player.objects.filter(current_rating__gt=p.current_rating).count() + 1
        data.append({
            'id': p.id,
            'first_name': p.first_name,
            'display_name': p.display_name,
            'last_name': p.last_name,
            'current_rating': p.current_rating,
            'tournaments_count': _tournaments_count(p.id, hard, medium, tbo),
            'matches_count': matches,
            'winrate': winrate,
            'rank': rank,
            'last5': last5,
        })
    return JsonResponse({
        'results': data,
        'page': page,
        'page_size': page_size,
        'total': total,
        'total_pages': total_pages,
    })


@require_GET
def player_history(request: HttpRequest, player_id: int) -> JsonResponse:
    rows = (
        PlayerRatingDynamic.objects
        .filter(player_id=player_id)
        .select_related('tournament')
        .order_by('tournament_date', 'id')
        .values(
            'tournament_id', 'tournament_date', 'tournament__name',
            'rating_before', 'rating_after', 'total_change', 'matches_count'
        )
    )
    return JsonResponse({'player_id': player_id, 'history': list(rows)})


@require_GET
def player_briefs(request: HttpRequest) -> JsonResponse:
    ids_raw = (request.GET.get('ids') or '').strip()
    if not ids_raw:
        return JsonResponse({'results': []})
    try:
        ids = [int(x) for x in ids_raw.split(',') if x.strip().isdigit()]
    except Exception:
        ids = []
    players = {p.id: p for p in Player.objects.filter(id__in=ids)}
    # Берём последнюю динамику по каждому игроку
    dyn_map = {}
    for d in PlayerRatingDynamic.objects.filter(player_id__in=ids).order_by('player_id', '-tournament_date', '-id'):
        if d.player_id not in dyn_map:
            dyn_map[d.player_id] = d
    results = []
    for pid in ids:
        p = players.get(pid)
        if not p:
            continue
        d = dyn_map.get(pid)
        rank = Player.objects.filter(current_rating__gt=getattr(p, 'current_rating', 0)).count() + 1
        results.append({
            'id': pid,
            'current_rating': getattr(p, 'current_rating', 0),
            'last_delta': getattr(d, 'total_change', 0) if d else 0,
            'rank': rank,
        })
    return JsonResponse({'results': results})


@require_GET
def player_match_deltas(request: HttpRequest, player_id: int) -> JsonResponse:
    from apps.players.models import PlayerRatingHistory
    items = list(
        PlayerRatingHistory.objects
        .filter(player_id=player_id)
        .select_related('match', 'tournament')
        .order_by('created_at', 'id')
        .values('id', 'value', 'created_at', 'match_id', 'tournament_id', 'tournament__name')
    )
    result = []
    match_ids = [it['match_id'] for it in items if it['match_id']]
    matches = {m.id: m for m in Match.objects.filter(id__in=match_ids).select_related('team_1', 'team_2', 'tournament')}
    for it in items:
        match_id = it['match_id']
        if match_id is None:
            continue
        m = matches.get(match_id)
        if not m:
            continue
        # Значение value в истории теперь — это дельта за ЭТОТ матч
        delta = it['value']
        opp = _opponent_name(m, player_id)
        partner = _partner_name(m, player_id)
        opp_ids = _opponent_ids(m, player_id)
        t1 = m.team_1
        t2 = m.team_2
        in_team1 = t1 and (t1.player_1_id == player_id or t1.player_2_id == player_id)
        partner_id = None
        if in_team1 and t1:
            ids = [t1.player_1_id, t1.player_2_id]
            ids = [pid for pid in ids if pid and pid != player_id]
            partner_id = ids[0] if ids else None
        elif (not in_team1) and t2:
            ids = [t2.player_1_id, t2.player_2_id]
            ids = [pid for pid in ids if pid and pid != player_id]
            partner_id = ids[0] if ids else None
        score = _match_score_str(m.id)
        result.append({
            'match_id': match_id,
            'tournament_id': m.tournament_id,
            'tournament_name': getattr(m.tournament, 'name', it['tournament__name']),
            'tournament_date': str(getattr(m.tournament, 'date', '') or ''),
            'tournament_system': getattr(m.tournament, 'system', ''),
            'participant_mode': getattr(m.tournament, 'participant_mode', ''),
            'finished_at': str(getattr(m, 'finished_at', '') or ''),
            'delta': delta,
            'opponent': opp,
            'opponent_ids': opp_ids,
            'partner': partner,
            'partner_id': partner_id,
            'score': score,
            'team1': [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None)],
            'team2': [getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)],
        })
    return JsonResponse({'player_id': player_id, 'matches': result})


@require_GET
def h2h(request: HttpRequest) -> JsonResponse:
    try:
        a = int(request.GET.get('a') or '0')
        b = int(request.GET.get('b') or '0')
    except Exception:
        return JsonResponse({'results': []})
    if not a or not b or a == b:
        return JsonResponse({'results': []})
    # Матчи, где A и B на противоположных сторонах
    q = (
        Q(team_1__player_1_id=a) | Q(team_1__player_2_id=a) | Q(team_2__player_1_id=a) | Q(team_2__player_2_id=a)
    ) & (
        Q(team_1__player_1_id=b) | Q(team_1__player_2_id=b) | Q(team_2__player_1_id=b) | Q(team_2__player_2_id=b)
    )
    # Подтянем динамику рейтингов "до турнира"
    dyn = {(d.player_id, d.tournament_id): d for d in PlayerRatingDynamic.objects.filter(player_id__in=[a, b])}
    dyn_cache: dict[tuple[int, int], PlayerRatingDynamic] = dict(dyn)

    # Построим словарь per-match дельт по A напрямую из истории
    from apps.players.models import PlayerRatingHistory
    a_hist = list(PlayerRatingHistory.objects.filter(player_id=a, match__isnull=False))
    a_delta_by_match: dict[int, int] = {h.match_id: int(h.value) for h in a_hist}

    def team_avg_before(tournament_id: int, p1: int | None, p2: int | None) -> float | None:
        ids = [pid for pid in [p1, p2] if pid]
        vals: list[float] = []
        for pid in ids:
            key = (pid, tournament_id)
            d = dyn_cache.get(key)
            if not d:
                d = PlayerRatingDynamic.objects.filter(player_id=pid, tournament_id=tournament_id).first()
                if d:
                    dyn_cache[key] = d
            if d:
                vals.append(float(d.rating_before))
        if not vals:
            return None
        return sum(vals) / len(vals)

    res = []
    # Возьмём все матчи, где учавствовали A и B
    matches = Match.objects.filter(q).select_related('team_1', 'team_2', 'tournament').order_by('-id')
    def flip_score(score: str) -> str:
        import re
        if not score:
            return score
        def repl(m):
            a_s, b_s = m.group(1), m.group(2)
            return f"{b_s}:{a_s}"
        return re.sub(r"(\d+):(\d+)", repl, score)

    for m in matches:
        t1_ids = [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None)] if m.team_1 else []
        t2_ids = [getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)] if m.team_2 else []
        # A должен быть в одной команде, B — в другой
        if (a in t1_ids and b in t1_ids) or (a in t2_ids and b in t2_ids):
            continue
        if not ((a in t1_ids and b in t2_ids) or (a in t2_ids and b in t1_ids)):
            continue
        delta_a = a_delta_by_match.get(m.id, 0)
        # Ориентируем так, чтобы команда A всегда была первой
        a_in_team1 = a in t1_ids
        if a_in_team1:
            out_team1 = t1_ids
            out_team2 = t2_ids
            out_score = _match_score_str(m.id)
        else:
            out_team1 = t2_ids
            out_team2 = t1_ids
            out_score = flip_score(_match_score_str(m.id))
        avg1 = team_avg_before(m.tournament_id, *(out_team1 + [None, None])[:2])
        avg2 = team_avg_before(m.tournament_id, *(out_team2 + [None, None])[:2])
        res.append({
            'match_id': m.id,
            'tournament_id': m.tournament_id,
            'tournament_name': getattr(m.tournament, 'name', ''),
            'tournament_date': str(getattr(m.tournament, 'date', '') or ''),
            'team1': out_team1,
            'team2': out_team2,
            'score': out_score,
            'delta_for_a': delta_a,
            'team1_avg_before': avg1,
            'team2_avg_before': avg2,
        })
    return JsonResponse({'a': a, 'b': b, 'matches': res})


@require_GET
def player_relations(request: HttpRequest, player_id: int) -> JsonResponse:
    # Собираем только те матчи, которые фигурируют в PlayerRatingHistory игрока
    from apps.players.models import PlayerRatingHistory
    hist = list(
        PlayerRatingHistory.objects
        .filter(player_id=player_id)
        .exclude(match_id__isnull=True)
        .values_list('match_id', flat=True)
    )
    opponents: set[int] = set()
    partners: set[int] = set()
    partner_counts: dict[int, int] = {}
    for m in Match.objects.filter(id__in=hist).select_related('team_1', 'team_2'):
        t1 = m.team_1
        t2 = m.team_2
        ids1 = [getattr(t1, 'player_1_id', None), getattr(t1, 'player_2_id', None)] if t1 else []
        ids2 = [getattr(t2, 'player_1_id', None), getattr(t2, 'player_2_id', None)] if t2 else []
        if player_id in ids1:
            for pid in [pid for pid in ids1 if pid and pid != player_id]:
                partners.add(pid)
                partner_counts[pid] = partner_counts.get(pid, 0) + 1
            opponents.update([pid for pid in ids2 if pid])
        elif player_id in ids2:
            for pid in [pid for pid in ids2 if pid and pid != player_id]:
                partners.add(pid)
                partner_counts[pid] = partner_counts.get(pid, 0) + 1
            opponents.update([pid for pid in ids1 if pid])
    partners_list = [{'id': pid, 'count': partner_counts.get(pid, 0)} for pid in sorted(partners)]
    return JsonResponse({'player_id': player_id, 'opponents': sorted(opponents), 'partners': partners_list})


@require_GET
def player_top_wins(request: HttpRequest, player_id: int) -> JsonResponse:
    # Топ-5 побед по per-match дельте из истории
    from apps.players.models import PlayerRatingHistory
    top = list(
        PlayerRatingHistory.objects
        .filter(player_id=player_id, match__isnull=False, value__gt=0)
        .select_related('match__tournament', 'match__team_1', 'match__team_2')
        .order_by('-value')[:5]
    )
    # Соберём соперников/партнёра и счёт
    data = []
    for h in top:
        m = h.match
        if not m:
            continue
        opp = _opponent_name(m, player_id)
        partner = _partner_name(m, player_id)
        score = _match_score_str(m.id)
        data.append({
            'match_id': m.id,
            'tournament_id': m.tournament_id,
            'tournament_name': getattr(m.tournament, 'name', ''),
            'tournament_date': str(getattr(m.tournament, 'date', '') or ''),
            'delta': int(h.value),
            'opponent': opp,
            'partner': partner,
            'score': score,
        })
    return JsonResponse({'player_id': player_id, 'wins': data})
