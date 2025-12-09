"""
API views для Telegram Bot и Mini App
"""
from django.db.models import Count, Q
from rest_framework import status, viewsets
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from apps.tournaments.models import Tournament, TournamentEntry
from apps.teams.models import Team
from apps.players.models import Player

from .models import LinkCode, TelegramUser
from .serializers import LinkCodeSerializer, TelegramUserSerializer
from .api_serializers import (
    TournamentListSerializer,
    TournamentDetailSerializer,
    TournamentRegistrationSerializer,
    ProfileSerializer,
)
from .authentication import TelegramWebAppAuthentication


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def generate_link_code(request):
    """
    Генерация кода для связывания Telegram аккаунта
    
    POST /api/telegram/generate-code/
    """
    user = request.user
    
    # Проверяем, не связан ли уже аккаунт
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        return Response({
            'error': 'Аккаунт уже связан с Telegram',
            'telegram_user': TelegramUserSerializer(telegram_user).data
        }, status=status.HTTP_400_BAD_REQUEST)
    except TelegramUser.DoesNotExist:
        pass
    
    # Деактивируем старые неиспользованные коды этого пользователя
    LinkCode.objects.filter(user=user, is_used=False).update(is_used=True)
    
    # Генерируем новый код
    link_code = LinkCode.generate_code(user, expires_in_minutes=15)
    
    return Response({
        'code': link_code.code,
        'expires_at': link_code.expires_at,
        'instructions': (
            f'Отправь боту команду: /link {link_code.code}\n'
            f'Код действителен 15 минут.'
        )
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def telegram_status(request):
    """
    Проверка статуса связывания с Telegram
    
    GET /api/telegram/status/
    """
    user = request.user
    
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        return Response({
            'is_linked': True,
            'telegram_user': TelegramUserSerializer(telegram_user).data
        })
    except TelegramUser.DoesNotExist:
        # Проверяем, есть ли активный код
        active_code = LinkCode.objects.filter(
            user=user,
            is_used=False
        ).order_by('-created_at').first()
        
        if active_code and active_code.is_valid():
            return Response({
                'is_linked': False,
                'pending_code': LinkCodeSerializer(active_code).data
            })
        
        return Response({
            'is_linked': False,
            'pending_code': None
        })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def unlink_telegram(request):
    """
    Отвязка Telegram аккаунта
    
    POST /api/telegram/unlink/
    """
    user = request.user
    
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        telegram_user.user = None
        telegram_user.player = None
        telegram_user.save()
        
        return Response({
            'message': 'Telegram аккаунт успешно отвязан'
        })
    except TelegramUser.DoesNotExist:
        return Response({
            'error': 'Telegram аккаунт не был связан'
        }, status=status.HTTP_400_BAD_REQUEST)


# ============================================================================
# Telegram Mini App API
# ============================================================================

class MiniAppTournamentViewSet(viewsets.ReadOnlyModelViewSet):
    """
    API для турниров в Telegram Mini App
    
    Аутентификация через Telegram Web App initData
    """
    authentication_classes = [TelegramWebAppAuthentication]
    permission_classes = [AllowAny]  # Аутентификация опциональна
    
    def get_queryset(self):
        """Получение списка турниров"""
        queryset = Tournament.objects.annotate(
            participants_count=Count('entries')
        ).select_related('venue', 'organizer')
        
        # Фильтр по статусу
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        else:
            # По умолчанию показываем created и active
            queryset = queryset.filter(status__in=['created', 'active'])
        
        return queryset.order_by('-date', '-created_at')
    
    def get_serializer_class(self):
        """Выбор сериализатора"""
        if self.action == 'retrieve':
            return TournamentDetailSerializer
        return TournamentListSerializer
    
    @action(detail=False, methods=['get'])
    def my_tournaments(self, request):
        """
        Мои турниры
        
        GET /api/mini-app/tournaments/my_tournaments/
        """
        if not request.auth or not request.auth.player_id:
            return Response({
                'error': 'Игрок не найден'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Находим команды игрока
        team_ids = Team.objects.filter(
            Q(player_1_id=request.auth.player_id) |
            Q(player_2_id=request.auth.player_id)
        ).values_list('id', flat=True)
        
        # Находим турниры через участников
        tournament_ids = TournamentEntry.objects.filter(
            team_id__in=team_ids
        ).values_list('tournament_id', flat=True).distinct()
        
        # Получаем турниры по статусам
        active_tournaments = Tournament.objects.filter(
            id__in=tournament_ids,
            status='active'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')
        
        created_tournaments = Tournament.objects.filter(
            id__in=tournament_ids,
            status='created'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('date', 'created_at')
        
        # Считаем сколько осталось места для completed
        active_count = active_tournaments.count()
        created_count = created_tournaments.count()
        total_shown = active_count + created_count
        
        if total_shown < 5:
            completed_limit = 5 - total_shown
        else:
            completed_limit = 1
        
        completed_tournaments = Tournament.objects.filter(
            id__in=tournament_ids,
            status='completed'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')[:completed_limit]
        
        # Объединяем
        tournaments = list(active_tournaments) + list(created_tournaments) + list(completed_tournaments)
        
        serializer = TournamentListSerializer(
            tournaments,
            many=True,
            context={'request': request}
        )
        
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def register(self, request, pk=None):
        """
        Регистрация на турнир
        
        POST /api/mini-app/tournaments/{id}/register/
        Body: { "partner_id": 123 }  # опционально
        """
        tournament = self.get_object()
        
        if not request.auth or not request.auth.player_id:
            return Response({
                'error': 'Игрок не найден'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        serializer = TournamentRegistrationSerializer(
            data={'tournament_id': tournament.id, **request.data},
            context={'request': request}
        )
        
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        # Создаём или находим команду
        player = Player.objects.get(id=request.auth.player_id)
        partner_id = serializer.validated_data.get('partner_id')
        
        if partner_id:
            # Регистрация с партнёром
            try:
                partner = Player.objects.get(id=partner_id)
            except Player.DoesNotExist:
                return Response({
                    'error': 'Партнёр не найден'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Ищем существующую команду или создаём новую
            team = Team.objects.filter(
                Q(player_1=player, player_2=partner) |
                Q(player_1=partner, player_2=player)
            ).first()
            
            if not team:
                team = Team.objects.create(
                    player_1=player,
                    player_2=partner
                )
        else:
            # Регистрация без партнёра (одиночная)
            team = Team.objects.filter(
                player_1=player,
                player_2__isnull=True
            ).first()
            
            if not team:
                team = Team.objects.create(player_1=player)
        
        # Регистрируем команду на турнир
        entry, created = TournamentEntry.objects.get_or_create(
            tournament=tournament,
            team=team
        )
        
        if not created:
            return Response({
                'error': 'Команда уже зарегистрирована'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        return Response({
            'message': 'Успешно зарегистрированы на турнир',
            'tournament': TournamentDetailSerializer(tournament, context={'request': request}).data
        }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([AllowAny])
def mini_app_profile(request):
    """
    Профиль пользователя в Mini App
    
    GET /api/mini-app/profile/
    """
    # Используем Telegram аутентификацию
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({
            'error': str(e)
        }, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user:
        return Response({
            'error': 'Telegram пользователь не найден'
        }, status=status.HTTP_404_NOT_FOUND)
    
    serializer = ProfileSerializer(telegram_user)
    return Response(serializer.data)
