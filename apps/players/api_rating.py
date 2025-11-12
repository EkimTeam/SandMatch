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


def _match_score_str(match_id: int) -> str:
    sets = list(MatchSet.objects.filter(match_id=match_id).order_by('index'))
    if not sets:
        return ''
    parts: List[str] = []
    for s in sets:
        if s.is_tiebreak_only:
            if s.tb_1 is not None and s.tb_2 is not None:
                parts.append(f"TB({s.tb_1}:{s.tb_2})")
            else:
                parts.append("TB")
        else:
            base = f"{s.games_1}:{s.games_2}"
            if (s.tb_1 is not None) and (s.tb_2 is not None):
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
    return ' & '.join(names)


def _last5_badges(player_id: int, hard: bool, medium: bool, tbo: bool) -> List[Dict[str, Any]]:
    qs = Match.objects.filter(_match_base_q(player_id, hard, medium, tbo)).order_by('-id')[:5]
    result: List[Dict[str, Any]] = []
    for m in qs:
        if m.winner_id is None:
            res = 'U'
        else:
            in_team1 = (m.team_1 and (m.team_1.player_1_id == player_id or m.team_1.player_2_id == player_id))
            in_team2 = (m.team_2 and (m.team_2.player_1_id == player_id or m.team_2.player_2_id == player_id))
            won = (in_team1 and m.winner_id == getattr(m, 'team_1_id', None)) or (in_team2 and m.winner_id == getattr(m, 'team_2_id', None))
            res = 'W' if won else 'L'
        result.append({
            'match_id': m.id,
            'result': res,
            'tournament_id': m.tournament_id,
            'opponent': _opponent_name(m, player_id),
            'score': _match_score_str(m.id),
        })
    return result


def _matches_count(player_id: int, hard: bool, medium: bool, tbo: bool) -> int:
    return Match.objects.filter(_match_base_q(player_id, hard, medium, tbo)).count()


def _tournaments_count(player_id: int, hard: bool, medium: bool, tbo: bool) -> int:
    return (
        Match.objects
        .filter(_match_base_q(player_id, hard, medium, tbo))
        .values('tournament_id')
        .distinct()
        .count()
    )


@require_GET
def leaderboard(request: HttpRequest) -> JsonResponse:
    # Параметры фильтров (пока заглушки — будут применены в выборках позднее)
    hard = request.GET.get('hard') in ('1', 'true', 'True')
    medium = request.GET.get('medium') in ('1', 'true', 'True')
    tbo = request.GET.get('tiebreak_only') in ('1', 'true', 'True')

    players = (
        Player.objects
        .order_by('-current_rating')[:200]
    )
    data = []
    for p in players:
        last5 = _last5_badges(p.id, hard, medium, tbo)
        data.append({
            'id': p.id,
            'display_name': p.display_name,
            'last_name': p.last_name,
            'current_rating': p.current_rating,
            'tournaments_count': _tournaments_count(p.id, hard, medium, tbo),
            'matches_count': _matches_count(p.id, hard, medium, tbo),
            'last5': last5,
        })
    return JsonResponse({'results': data})


@require_GET
def player_history(request: HttpRequest, player_id: int) -> JsonResponse:
    rows = (
        PlayerRatingDynamic.objects
        .filter(player_id=player_id)
        .order_by('tournament_date', 'id')
        .values(
            'tournament_id', 'tournament_date',
            'rating_before', 'rating_after', 'total_change', 'matches_count'
        )
    )
    return JsonResponse({'player_id': player_id, 'history': list(rows)})
