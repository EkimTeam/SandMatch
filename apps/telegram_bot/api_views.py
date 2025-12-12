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
        base_qs = Tournament.objects.annotate(
            participants_count=Count('entries')
        ).select_related('venue', 'created_by')

        # Для детального просмотра не ограничиваем по статусу,
        # чтобы можно было открывать completed турниры.
        if getattr(self, 'action', None) == 'retrieve':
            return base_qs.order_by('-date', '-created_at')

        queryset = base_qs

        # Фильтр по статусу для списков
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
        # Ошибка на этапе валидации initData или поиска TelegramUser
        return Response({
            'error': str(e)
        }, status=status.HTTP_401_UNAUTHORIZED)

    try:
        if not telegram_user:
            return Response({
                'error': 'Telegram пользователь не найден'
            }, status=status.HTTP_404_NOT_FOUND)

        serializer = ProfileSerializer(telegram_user)
        return Response(serializer.data)
    except Exception as e:
        # Временный блок для дебага продакшена: показать текст ошибки вместо немого 500
        return Response({
            'error': str(e)
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# --- Новые эндпоинты для системы регистрации ---

@api_view(['GET'])
@permission_classes([AllowAny])
def tournament_participants(request, tournament_id):
    """
    Получить список участников турнира (основной состав, резерв, ищущие пару)
    
    GET /api/mini-app/tournaments/{id}/participants/
    """
    from apps.tournaments.registration_models import TournamentRegistration
    from .api_serializers import TournamentParticipantsSerializer, TournamentRegistrationSerializer
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
    except Tournament.DoesNotExist:
        return Response({
            'error': 'Турнир не найден'
        }, status=status.HTTP_404_NOT_FOUND)
    
    # Получаем регистрации по статусам
    main_list = TournamentRegistration.objects.filter(
        tournament=tournament,
        status=TournamentRegistration.Status.MAIN_LIST
    ).select_related('player', 'partner')
    
    reserve_list = TournamentRegistration.objects.filter(
        tournament=tournament,
        status=TournamentRegistration.Status.RESERVE_LIST
    ).select_related('player', 'partner')
    
    looking_for_partner = TournamentRegistration.objects.filter(
        tournament=tournament,
        status=TournamentRegistration.Status.LOOKING_FOR_PARTNER
    ).select_related('player')
    
    data = {
        'main_list': TournamentRegistrationSerializer(main_list, many=True).data,
        'reserve_list': TournamentRegistrationSerializer(reserve_list, many=True).data,
        'looking_for_partner': TournamentRegistrationSerializer(looking_for_partner, many=True).data,
    }
    
    return Response(data)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_looking_for_partner(request, tournament_id):
    """
    Зарегистрироваться на турнир в режиме "ищет пару"
    
    POST /api/mini-app/tournaments/{id}/register-looking-for-partner/
    """
    from apps.tournaments.services import RegistrationService
    from .api_serializers import TournamentRegistrationSerializer
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        player = Player.objects.get(id=telegram_user.player_id)
    except (Tournament.DoesNotExist, Player.DoesNotExist) as e:
        return Response({'error': str(e)}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        registration = RegistrationService.register_looking_for_partner(tournament, player)
        return Response(
            TournamentRegistrationSerializer(registration).data,
            status=status.HTTP_201_CREATED
        )
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_with_partner(request, tournament_id):
    """
    Зарегистрироваться на турнир с напарником
    
    POST /api/mini-app/tournaments/{id}/register-with-partner/
    Body: { "partner_id": 123 }
    """
    from apps.tournaments.services import RegistrationService
    from .api_serializers import RegisterWithPartnerSerializer, TournamentRegistrationSerializer
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    serializer = RegisterWithPartnerSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        player = Player.objects.get(id=telegram_user.player_id)
        partner = Player.objects.get(id=serializer.validated_data['partner_id'])
    except (Tournament.DoesNotExist, Player.DoesNotExist) as e:
        return Response({'error': str(e)}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        registration = RegistrationService.register_with_partner(tournament, player, partner)
        return Response(
            TournamentRegistrationSerializer(registration).data,
            status=status.HTTP_201_CREATED
        )
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def send_pair_invitation(request, tournament_id):
    """
    Отправить приглашение в пару
    
    POST /api/mini-app/tournaments/{id}/send-invitation/
    Body: { "receiver_id": 123, "message": "Давай сыграем!" }
    """
    from apps.tournaments.services import RegistrationService
    from .api_serializers import SendPairInvitationSerializer, PairInvitationSerializer
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    serializer = SendPairInvitationSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        sender = Player.objects.get(id=telegram_user.player_id)
        receiver = Player.objects.get(id=serializer.validated_data['receiver_id'])
    except (Tournament.DoesNotExist, Player.DoesNotExist) as e:
        return Response({'error': str(e)}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        invitation = RegistrationService.send_pair_invitation(
            tournament, sender, receiver,
            message=serializer.validated_data.get('message', '')
        )
        return Response(
            PairInvitationSerializer(invitation).data,
            status=status.HTTP_201_CREATED
        )
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([AllowAny])
def my_invitations(request):
    """
    Получить список приглашений текущего игрока
    
    GET /api/mini-app/invitations/
    """
    from apps.tournaments.registration_models import PairInvitation
    from .api_serializers import PairInvitationSerializer
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    player = Player.objects.get(id=telegram_user.player_id)
    
    # Получаем входящие приглашения (pending)
    invitations = PairInvitation.objects.filter(
        receiver=player,
        status=PairInvitation.Status.PENDING
    ).select_related('sender', 'tournament').order_by('-created_at')
    
    return Response(PairInvitationSerializer(invitations, many=True).data)


@api_view(['POST'])
@permission_classes([AllowAny])
def accept_invitation(request, invitation_id):
    """
    Принять приглашение в пару
    
    POST /api/mini-app/invitations/{id}/accept/
    """
    from apps.tournaments.registration_models import PairInvitation
    from apps.tournaments.services import RegistrationService
    from .api_serializers import TournamentRegistrationSerializer
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        invitation = PairInvitation.objects.get(id=invitation_id)
    except PairInvitation.DoesNotExist:
        return Response({'error': 'Приглашение не найдено'}, status=status.HTTP_404_NOT_FOUND)
    
    # Проверяем, что текущий игрок - получатель
    if invitation.receiver_id != telegram_user.player_id:
        return Response({'error': 'Недостаточно прав'}, status=status.HTTP_403_FORBIDDEN)
    
    try:
        sender_reg, receiver_reg = RegistrationService.accept_pair_invitation(invitation)
        return Response({
            'message': 'Приглашение принято',
            'registration': TournamentRegistrationSerializer(receiver_reg).data
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def decline_invitation(request, invitation_id):
    """
    Отклонить приглашение в пару
    
    POST /api/mini-app/invitations/{id}/decline/
    """
    from apps.tournaments.registration_models import PairInvitation
    from apps.tournaments.services import RegistrationService
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        invitation = PairInvitation.objects.get(id=invitation_id)
    except PairInvitation.DoesNotExist:
        return Response({'error': 'Приглашение не найдено'}, status=status.HTTP_404_NOT_FOUND)
    
    # Проверяем, что текущий игрок - получатель
    if invitation.receiver_id != telegram_user.player_id:
        return Response({'error': 'Недостаточно прав'}, status=status.HTTP_403_FORBIDDEN)
    
    try:
        RegistrationService.decline_pair_invitation(invitation)
        return Response({'message': 'Приглашение отклонено'})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def cancel_registration(request, tournament_id):
    """
    Отменить свою регистрацию на турнир
    
    POST /api/mini-app/tournaments/{id}/cancel-registration/
    """
    from apps.tournaments.registration_models import TournamentRegistration
    from apps.tournaments.services import RegistrationService
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        registration = TournamentRegistration.objects.get(
            tournament=tournament,
            player_id=telegram_user.player_id
        )
    except (Tournament.DoesNotExist, TournamentRegistration.DoesNotExist):
        return Response({'error': 'Регистрация не найдена'}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        RegistrationService.cancel_registration(registration)
        return Response({'message': 'Регистрация отменена'})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
