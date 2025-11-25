"""
API для рейтингов BTR (BeachTennisRussia).
Аналог apps/players/api_rating.py для системы BTR.
"""
from typing import Any, Dict, List
from django.http import HttpRequest
from django.db.models import Q, Max, Min
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.btr.models import BtrPlayer, BtrRatingSnapshot


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def btr_leaderboard(request: HttpRequest) -> Response:
    """
    Таблица лидеров BTR по всем 6 категориям.
    
    Параметры:
        - q: поиск по имени (опционально)
        
    Возвращает:
        - categories: словарь {category_code: {label, results, latest_date}}
        - Для каждой категории results содержит список игроков с рейтингом и позицией
        - При поиске сохраняется позиция из общего рейтинга категории
    """
    # Параметры
    q = (request.GET.get('q') or '').strip()

    # Получаем последнюю дату рейтинга для каждой категории
    latest_dates = {}
    for cat_choice in BtrRatingSnapshot.Category.choices:
        cat_code = cat_choice[0]
        latest_date = BtrRatingSnapshot.objects.filter(category=cat_code).aggregate(
            max_date=Max('rating_date')
        )['max_date']
        if latest_date:
            latest_dates[cat_code] = latest_date

    # Если нет данных, возвращаем пустой результат
    if not latest_dates:
        return Response({'categories': {}})

    # Получаем все последние снимки для всех категорий
    all_snapshots = []
    for cat_code, latest_date in latest_dates.items():
        snapshots = BtrRatingSnapshot.objects.filter(
            category=cat_code,
            rating_date=latest_date
        ).select_related('player').order_by('-rating_value')
        all_snapshots.extend(list(snapshots))

    # Группируем снимки по категориям и вычисляем позиции
    categories_data = {}
    
    for cat_choice in BtrRatingSnapshot.Category.choices:
        cat_code = cat_choice[0]
        cat_label = cat_choice[1]
        
        if cat_code not in latest_dates:
            continue
        
        # Фильтруем снимки для этой категории
        cat_snapshots = [s for s in all_snapshots if s.category == cat_code]
        
        # Сортируем по рейтингу (по убыванию)
        cat_snapshots.sort(key=lambda s: s.rating_value, reverse=True)
        
        # Вычисляем позиции с учётом одинаковых рейтингов
        results = []
        current_rank = 0
        prev_rating = None
        
        for idx, snapshot in enumerate(cat_snapshots):
            # Если рейтинг отличается от предыдущего, обновляем позицию
            if snapshot.rating_value != prev_rating:
                current_rank = idx + 1
                prev_rating = snapshot.rating_value
            
            player = snapshot.player
            
            # Применяем поиск
            if q:
                if not (q.lower() in player.first_name.lower() or 
                       q.lower() in player.last_name.lower() or 
                       q.lower() in (player.middle_name or '').lower()):
                    continue
            
            results.append({
                'id': player.id,
                'rni': player.rni,
                'first_name': player.first_name,
                'last_name': player.last_name,
                'middle_name': player.middle_name,
                'gender': player.gender,
                'birth_date': str(player.birth_date) if player.birth_date else None,
                'city': player.city,
                'current_rating': snapshot.rating_value,
                'rank': current_rank,  # Позиция с учётом одинаковых рейтингов
                'category': snapshot.category,
                'category_display': snapshot.get_category_display(),
                'rating_date': str(snapshot.rating_date),
                'tournaments_total': snapshot.tournaments_total,
                'tournaments_52_weeks': snapshot.tournaments_52_weeks,
                'tournaments_counted': snapshot.tournaments_counted,
            })
        
        categories_data[cat_code] = {
            'label': cat_label,
            'results': results,
            'latest_date': str(latest_dates[cat_code]),
            'total': len(results),
        }

    return Response({'categories': categories_data})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def btr_player_detail(request: HttpRequest, player_id: int) -> Response:
    """
    Детальная информация об игроке BTR.
    
    Возвращает:
        - player: основная информация об игроке
        - categories: текущий рейтинг по каждой категории (если есть)
        - stats: статистика по каждой категории (макс/мин рейтинг, всего турниров)
    """
    # Проверяем существование игрока
    try:
        player = BtrPlayer.objects.get(id=player_id)
    except BtrPlayer.DoesNotExist:
        return Response({'error': 'Player not found'}, status=404)

    # Получаем последние снимки по всем категориям
    latest_snapshots = {}
    for cat_choice in BtrRatingSnapshot.Category.choices:
        cat_code = cat_choice[0]
        latest_snapshot = BtrRatingSnapshot.objects.filter(
            player_id=player_id,
            category=cat_code
        ).order_by('-rating_date').first()
        
        if latest_snapshot:
            latest_snapshots[cat_code] = {
                'category': cat_code,
                'category_display': latest_snapshot.get_category_display(),
                'current_rating': latest_snapshot.rating_value,
                'rank': latest_snapshot.rank,
                'rating_date': str(latest_snapshot.rating_date),
                'tournaments_total': latest_snapshot.tournaments_total,
                'tournaments_52_weeks': latest_snapshot.tournaments_52_weeks,
                'tournaments_counted': latest_snapshot.tournaments_counted,
            }

    # Получаем статистику по каждой категории
    stats = {}
    for cat_code in latest_snapshots.keys():
        snapshots = BtrRatingSnapshot.objects.filter(
            player_id=player_id,
            category=cat_code
        ).aggregate(
            max_rating=Max('rating_value'),
            min_rating=Min('rating_value'),
            total_tournaments=Max('tournaments_total')
        )
        stats[cat_code] = {
            'max_rating': snapshots['max_rating'],
            'min_rating': snapshots['min_rating'],
            'total_tournaments': snapshots['total_tournaments'] or 0,
        }

    return Response({
        'player': {
            'id': player.id,
            'rni': player.rni,
            'first_name': player.first_name,
            'last_name': player.last_name,
            'middle_name': player.middle_name,
            'gender': player.gender,
            'birth_date': str(player.birth_date) if player.birth_date else None,
            'city': player.city,
        },
        'categories': latest_snapshots,
        'stats': stats,
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def btr_player_history(request: HttpRequest, player_id: int) -> Response:
    """
    История рейтинга BTR для конкретного игрока.
    
    Параметры:
        - category: фильтр по категории (опционально, если не указана - все категории)
        
    Возвращает:
        - player_id: ID игрока BTR
        - history: список снимков рейтинга по датам
    """
    category = (request.GET.get('category') or '').strip()

    # Проверяем существование игрока
    try:
        player = BtrPlayer.objects.get(id=player_id)
    except BtrPlayer.DoesNotExist:
        return Response({'error': 'Player not found'}, status=404)

    # Получаем историю рейтинга
    snapshots_qs = BtrRatingSnapshot.objects.filter(player_id=player_id)
    
    if category:
        snapshots_qs = snapshots_qs.filter(category=category)

    snapshots = snapshots_qs.order_by('rating_date', 'category').values(
        'id', 'category', 'rating_date', 'rating_value', 'rank',
        'tournaments_total', 'tournaments_52_weeks', 'tournaments_counted'
    )

    # Группируем по категориям для удобства
    history_by_category = {}
    for snapshot in snapshots:
        cat = snapshot['category']
        if cat not in history_by_category:
            history_by_category[cat] = []
        history_by_category[cat].append({
            'date': str(snapshot['rating_date']),
            'rating': snapshot['rating_value'],
            'rank': snapshot['rank'],
            'tournaments_total': snapshot['tournaments_total'],
            'tournaments_52_weeks': snapshot['tournaments_52_weeks'],
            'tournaments_counted': snapshot['tournaments_counted'],
        })

    return Response({
        'player_id': player_id,
        'rni': player.rni,
        'full_name': f"{player.last_name} {player.first_name} {player.middle_name}".strip(),
        'history_by_category': history_by_category,
        'history': list(snapshots),  # Плоский список для обратной совместимости
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def btr_player_by_bp_id(request: HttpRequest, bp_player_id: int) -> Response:
    """
    Получить информацию о BTR рейтингах игрока по ID BP игрока.
    Используется для отображения BTR информации на странице BP игрока.
    
    Возвращает:
        - btr_player_id: ID игрока в системе BTR (если найден)
        - categories: текущие рейтинги по категориям BTR
    """
    from apps.players.models import Player as BpPlayer
    
    try:
        bp_player = BpPlayer.objects.get(id=bp_player_id)
    except BpPlayer.DoesNotExist:
        return Response({'btr_player_id': None, 'categories': {}})
    
    # Проверяем, есть ли связь с BTR
    if not bp_player.btr_player_id:
        return Response({'btr_player_id': None, 'categories': {}})
    
    try:
        btr_player = BtrPlayer.objects.get(id=bp_player.btr_player_id)
    except BtrPlayer.DoesNotExist:
        return Response({'btr_player_id': None, 'categories': {}})

    # Получаем последние снимки по всем категориям
    latest_snapshots = {}
    for cat_choice in BtrRatingSnapshot.Category.choices:
        cat_code = cat_choice[0]
        latest_snapshot = BtrRatingSnapshot.objects.filter(
            player_id=btr_player.id,
            category=cat_code
        ).order_by('-rating_date').first()
        
        if latest_snapshot:
            latest_snapshots[cat_code] = {
                'category': cat_code,
                'category_display': latest_snapshot.get_category_display(),
                'current_rating': latest_snapshot.rating_value,
                'rank': latest_snapshot.rank,
            }

    return Response({
        'btr_player_id': btr_player.id,
        'categories': latest_snapshots,
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def btr_player_brief(request: HttpRequest, player_id: int) -> Response:
    """
    Краткая информация об игроке BTR (публичный эндпоинт).
    
    Возвращает:
        - Базовую информацию об игроке
        - Текущий рейтинг в основной категории
    """
    try:
        player = BtrPlayer.objects.get(id=player_id)
    except BtrPlayer.DoesNotExist:
        return Response({'error': 'Player not found'}, status=404)

    # Получаем последний снимок в основной категории (по полу)
    main_category = 'men_double' if player.gender == 'male' else 'women_double'
    
    latest_snapshot = BtrRatingSnapshot.objects.filter(
        player_id=player_id,
        category=main_category
    ).order_by('-rating_date').first()

    result = {
        'id': player.id,
        'rni': player.rni,
        'first_name': player.first_name,
        'last_name': player.last_name,
        'middle_name': player.middle_name,
        'gender': player.gender,
        'birth_date': str(player.birth_date) if player.birth_date else None,
        'city': player.city,
        'country': player.country,
    }

    if latest_snapshot:
        result.update({
            'current_rating': latest_snapshot.rating_value,
            'rank': latest_snapshot.rank,
            'category': latest_snapshot.category,
            'rating_date': str(latest_snapshot.rating_date),
        })
    else:
        result.update({
            'current_rating': None,
            'rank': None,
            'category': None,
            'rating_date': None,
        })

    return Response(result)


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def btr_categories(request: HttpRequest) -> Response:
    """
    Список доступных категорий BTR с количеством игроков в каждой.
    
    Возвращает:
        - categories: список категорий с метаданными
    """
    categories = []
    
    for cat_choice in BtrRatingSnapshot.Category.choices:
        cat_code = cat_choice[0]
        cat_label = cat_choice[1]
        
        # Получаем последнюю дату для категории
        latest_date = BtrRatingSnapshot.objects.filter(category=cat_code).aggregate(
            max_date=Max('rating_date')
        )['max_date']
        
        if not latest_date:
            continue
        
        # Считаем количество игроков
        players_count = BtrRatingSnapshot.objects.filter(
            category=cat_code,
            rating_date=latest_date
        ).count()
        
        categories.append({
            'code': cat_code,
            'label': cat_label,
            'players_count': players_count,
            'latest_date': str(latest_date),
        })
    
    return Response({'categories': categories})
