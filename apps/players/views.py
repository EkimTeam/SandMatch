from __future__ import annotations
from django.shortcuts import render
from django.views.generic import ListView
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
from django.db import IntegrityError, connection, transaction
from django.db.models import Q
import json

from apps.players.models import Player
from apps.players.services.initial_rating_service import get_initial_bp_rating


class PlayersListView(ListView):
    model = Player
    template_name = "players/list.html"
    context_object_name = "players"


@require_GET
def search_players(request):
    query = request.GET.get('q', '').strip()
    if len(query) < 2:
        return JsonResponse({'players': []})
    
    players = Player.objects.filter(
        Q(first_name__icontains=query) | Q(last_name__icontains=query) | Q(display_name__icontains=query)
    ).order_by('last_name', 'first_name')[:10]
    
    return JsonResponse({
        'players': [{
            'id': p.id,
            'display_name': p.display_name,
            'full_name': f"{p.last_name} {p.first_name}"
        } for p in players]
    })


@csrf_exempt
@require_POST
def create_player(request):
    try:
        data = json.loads(request.body)
        first_name = data.get('first_name', '').strip()
        last_name = data.get('last_name', '').strip()
        
        if not first_name or not last_name:
            return JsonResponse({'error': 'Имя и фамилия обязательны'}, status=400)
        
        # Проверка существования игрока
        existing = Player.objects.filter(
            first_name__iexact=first_name,
            last_name__iexact=last_name
        ).first()
        
        if existing:
            return JsonResponse({'error': f'Игрок {existing.display_name} уже существует'}, status=400)
        
        # Определяем стартовый рейтинг (проверяем BTR)
        initial_rating = get_initial_bp_rating(Player(first_name=first_name, last_name=last_name))
        
        # Пытаемся создать игрока. Если произошло "duplicate key value ... players_player_pkey",
        # то это признак рассинхронизации последовательности id после ручных вставок.
        try:
            player = Player.objects.create(
                first_name=first_name,
                last_name=last_name,
                current_rating=initial_rating
            )
        except IntegrityError as e:
            msg = str(e)
            if 'players_player_pkey' in msg or 'duplicate key value' in msg:
                # Чиним последовательность и пробуем ещё раз
                with transaction.atomic():
                    with connection.cursor() as cur:
                        cur.execute(
                            'SELECT setval(pg_get_serial_sequence(%s, %s), COALESCE(MAX(id), 1)) FROM "players_player";',
                            ('"players_player"', 'id')
                        )
                player = Player.objects.create(
                    first_name=first_name,
                    last_name=last_name,
                    current_rating=initial_rating
                )
            else:
                raise
        
        return JsonResponse({
            'id': player.id,
            'display_name': player.display_name,
            'full_name': f"{player.last_name} {player.first_name}"
        })
    except IntegrityError as e:
        return JsonResponse({'error': 'Ошибка базы данных при создании игрока'}, status=500)
    except Exception as e:
        return JsonResponse({'error': 'Внутренняя ошибка сервера при создании игрока'}, status=500)
