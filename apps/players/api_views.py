from __future__ import annotations
from typing import List, Dict, Any
from django.http import JsonResponse, HttpRequest, HttpResponseBadRequest
from django.views.decorators.http import require_GET
from django.db.models import Q, Count, OuterRef, Subquery, IntegerField, Exists
from django.db.models.functions import Coalesce

from apps.players.models import Player, PlayerRatingDynamic
from apps.teams.models import Team
from apps.matches.models import Match


def _player_teams_subquery(player_field: str):
    return Team.objects.filter(
        Q(player_1_id=OuterRef("pk")) | Q(player_2_id=OuterRef("pk"))
    ).values("id")


@require_GET
def ratings_leaderboard(request: HttpRequest) -> JsonResponse:
    """
    Список лидеров рейтинга: текущий рейтинг, кол-во турниров и матчей, последние 5 результатов.
    Поддерживает параметры: ?limit=200&min_matches=0&min_tournaments=0&search=...
    """
    try:
        limit = int(request.GET.get("limit") or 200)
        min_matches = int(request.GET.get("min_matches") or 0)
        min_tournaments = int(request.GET.get("min_tournaments") or 0)
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid params")

    search = (request.GET.get("search") or "").strip()

    # Базовый список игроков - показываем всех с рейтингом > 0
    # Если есть поиск, ищем среди всех игроков
    if search:
        players_qs = Player.objects.filter(
            Q(first_name__icontains=search) | Q(last_name__icontains=search) | Q(display_name__icontains=search)
        )
    else:
        # Без поиска показываем только тех, у кого есть рейтинг
        players_qs = Player.objects.filter(current_rating__gt=0)

    # Отладочная информация
    total_count = players_qs.count()
    
    # Сначала получаем список игроков для дальнейшей обработки
    # Увеличиваем лимит, чтобы после фильтрации осталось достаточно
    players_list = list(players_qs.order_by("-current_rating", "last_name", "first_name")[:limit * 2])
    player_ids = [p.id for p in players_list]
    
    # Логируем для отладки
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"ratings_leaderboard: total={total_count}, after_limit={len(players_list)}, player_ids={player_ids[:5]}")
    
    # Подсчёт матчей и турниров для каждого игрока
    # Получаем все команды и матчи заранее для оптимизации
    all_teams = Team.objects.filter(
        Q(player_1_id__in=player_ids) | Q(player_2_id__in=player_ids)
    ).select_related("player_1", "player_2")
    
    team_to_players = {}
    for team in all_teams:
        if team.player_1_id:
            team_to_players.setdefault(team.id, []).append(team.player_1_id)
        if team.player_2_id:
            team_to_players.setdefault(team.id, []).append(team.player_2_id)
    
    team_ids = list(team_to_players.keys())
    all_matches = Match.objects.filter(
        Q(team_1_id__in=team_ids) | Q(team_2_id__in=team_ids),
        status=Match.Status.COMPLETED
    ).values("id", "tournament_id", "team_1_id", "team_2_id")
    
    # Собираем статистику по игрокам
    player_stats = {}
    for match in all_matches:
        team1_id = match["team_1_id"]
        team2_id = match["team_2_id"]
        tournament_id = match["tournament_id"]
        
        for team_id in [team1_id, team2_id]:
            if team_id and team_id in team_to_players:
                for player_id in team_to_players[team_id]:
                    if player_id not in player_stats:
                        player_stats[player_id] = {"matches": set(), "tournaments": set()}
                    player_stats[player_id]["matches"].add(match["id"])
                    player_stats[player_id]["tournaments"].add(tournament_id)
    
    # Фильтруем по минимальным требованиям
    # ВАЖНО: игроки уже отфильтрованы по current_rating > 0 на этапе players_qs
    # Здесь мы только применяем фильтры по матчам/турнирам, если они заданы
    filtered_players = []
    for p in players_list:
        stats = player_stats.get(p.id, {"matches": set(), "tournaments": set()})
        matches_count = len(stats["matches"])
        tournaments_count = len(stats["tournaments"])
        
        # Если фильтры не заданы, показываем всех (они уже отфильтрованы по рейтингу)
        if min_matches == 0 and min_tournaments == 0:
            filtered_players.append((p, matches_count, tournaments_count))
        else:
            # С фильтрами проверяем соответствие
            if matches_count >= min_matches and tournaments_count >= min_tournaments:
                filtered_players.append((p, matches_count, tournaments_count))
    
    # Сортируем по рейтингу (уже отсортированы, но на всякий случай)
    filtered_players.sort(key=lambda x: (-x[0].current_rating or 0, x[0].last_name, x[0].first_name))
    
    # Ограничиваем результат
    filtered_players = filtered_players[:limit]
    
    logger.info(f"ratings_leaderboard: after_filter={len(filtered_players)}")

    # Собираем последние 5 результатов на Python (читаемо и достаточно быстро при ограничении limit)
    payload: List[Dict[str, Any]] = []
    for p, matches_count, tournaments_count in filtered_players:
        team_ids = list(
            Team.objects.filter(Q(player_1_id=p.id) | Q(player_2_id=p.id)).values_list("id", flat=True)
        )
        recent = (
            Match.objects.filter(
                Q(team_1_id__in=team_ids) | Q(team_2_id__in=team_ids),
                status=Match.Status.COMPLETED,
            )
            .select_related("tournament", "team_1", "team_2", "winner")
            .order_by("-finished_at", "-updated_at", "-id")[:5]
        )
        last5: List[Dict[str, Any]] = []
        for m in recent:
            if not m.team_1_id or not m.team_2_id:
                continue
            # Победа, если winner соответствует команде игрока
            player_won = (m.winner_id in team_ids)
            opponent_team = m.team_2 if m.team_1_id in team_ids else m.team_1
            tooltip = f"{m.tournament.name} • {opponent_team} • {m.round_name or m.get_stage_display()}"
            last5.append({
                "match_id": m.id,
                "won": bool(player_won),
                "tooltip": tooltip,
            })

        payload.append({
            "id": p.id,
            "display_name": p.display_name or p.first_name,
            "full_name": f"{p.last_name} {p.first_name}",
            "current_rating": int(p.current_rating or 0),
            "matches_count": matches_count,
            "tournaments_count": tournaments_count,
            "last5": last5,
            "highlight_few": (tournaments_count < 5) or (matches_count < 10),
        })

    logger.info(f"ratings_leaderboard: final_payload_size={len(payload)}")
    
    # Временно добавляем отладочную информацию в ответ (можно убрать позже)
    debug_info = {}
    if request.GET.get("debug") == "1":
        debug_info = {
            "total_count": total_count,
            "players_list_size": len(players_list),
            "filtered_size": len(filtered_players),
            "payload_size": len(payload),
        }
    
    return JsonResponse({"results": payload, **debug_info})


@require_GET
def ratings_debug(request: HttpRequest) -> JsonResponse:
    """Отладочный endpoint для проверки данных рейтинга."""
    total_players = Player.objects.count()
    players_with_rating = Player.objects.filter(current_rating__gt=0).count()
    sample_players = list(Player.objects.filter(current_rating__gt=0)[:5].values('id', 'first_name', 'last_name', 'current_rating'))
    
    return JsonResponse({
        "total_players": total_players,
        "players_with_rating": players_with_rating,
        "sample_players": sample_players,
    })


@require_GET
def player_rating_history(request: HttpRequest, player_id: int) -> JsonResponse:
    """
    История рейтинга игрока по турнирам (для графика).
    Поддерживает ?from=YYYY-MM-DD&to=YYYY-MM-DD&compare_with=<player_id>
    """
    from_str = request.GET.get("from")
    to_str = request.GET.get("to")
    compare_with = request.GET.get("compare_with")

    try:
        qs = PlayerRatingDynamic.objects.filter(player_id=player_id).select_related("tournament")
        if from_str:
            qs = qs.filter(tournament__date__gte=from_str)
        if to_str:
            qs = qs.filter(tournament__date__lte=to_str)
        qs = qs.order_by("tournament__date", "tournament_id")

        data = [{
            "tournament_id": r.tournament_id,
            "tournament_name": r.tournament.name,
            "tournament_date": r.tournament.date.isoformat(),
            "rating_before": r.rating_before,
            "rating_after": r.rating_after,
            "total_change": r.total_change,
            "matches_count": r.matches_count,
        } for r in qs]

        compare_data = None
        if compare_with:
            try:
                compare_id = int(compare_with)
                cqs = PlayerRatingDynamic.objects.filter(player_id=compare_id)
                if from_str:
                    cqs = cqs.filter(tournament__date__gte=from_str)
                if to_str:
                    cqs = cqs.filter(tournament__date__lte=to_str)
                cqs = cqs.select_related("tournament").order_by("tournament__date", "tournament_id")
                compare_data = [{
                    "tournament_id": r.tournament_id,
                    "tournament_name": r.tournament.name,
                    "tournament_date": r.tournament.date.isoformat(),
                    "rating_before": r.rating_before,
                    "rating_after": r.rating_after,
                    "total_change": r.total_change,
                    "matches_count": r.matches_count,
                } for r in cqs]
            except ValueError:
                compare_data = None

        return JsonResponse({"history": data, "compare": compare_data})
    except Exception:
        return HttpResponseBadRequest("invalid params")


