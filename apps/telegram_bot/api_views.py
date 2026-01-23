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
    """Генерация кода для связывания Telegram аккаунта.

    Важно: считаем аккаунт уже связанным только если у TelegramUser есть telegram_id.
    Наличие "пустого" TelegramUser (без telegram_id) не блокирует генерацию кода.

    POST /api/telegram/generate-code/
    """
    user = request.user

    # Проверяем, не связан ли уже аккаунт (по наличию telegram_id)
    telegram_user = TelegramUser.objects.filter(user=user).first()
    if telegram_user and telegram_user.telegram_id:
        return Response({
            'error': 'Аккаунт уже связан с Telegram',
            'telegram_user': TelegramUserSerializer(telegram_user).data,
        }, status=status.HTTP_400_BAD_REQUEST)
    
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
    """Проверка статуса связывания с Telegram.

    Считаем, что аккаунт *связан*, только если есть TelegramUser с непустым telegram_id.

    GET /api/telegram/status/
    """

    user = request.user

    telegram_user = TelegramUser.objects.filter(user=user).first()
    if telegram_user and telegram_user.telegram_id:
        return Response({
            'is_linked': True,
            'telegram_user': TelegramUserSerializer(telegram_user).data,
        })

    # Нет telegram_id → считаем, что аккаунт не связан; смотрим активный код
    active_code = LinkCode.objects.filter(
        user=user,
        is_used=False,
    ).order_by('-created_at').first()

    if active_code and active_code.is_valid():
        return Response({
            'is_linked': False,
            'pending_code': LinkCodeSerializer(active_code).data,
        })

    return Response({
        'is_linked': False,
        'pending_code': None,
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
    except TelegramUser.DoesNotExist:
        return Response({'error': 'Telegram аккаунт не был связан'}, status=status.HTTP_400_BAD_REQUEST)

    if not telegram_user.telegram_id:
        return Response({'error': 'Telegram аккаунт не был связан'}, status=status.HTTP_400_BAD_REQUEST)

    # Убираем только Telegram‑ID и username, не разрывая связку User ↔ Player
    telegram_user.telegram_id = None
    telegram_user.username = None
    telegram_user.is_blocked = False
    telegram_user.save(update_fields=['telegram_id', 'username', 'is_blocked'])

    # Очищаем технические поля в UserProfile, если они используются
    try:
        from apps.accounts.models import UserProfile
        profile = UserProfile.objects.get(user=user)
    except UserProfile.DoesNotExist:
        profile = None

    if profile is not None:
        changed = False
        if getattr(profile, 'telegram_id', None) is not None:
            profile.telegram_id = None
            changed = True
        if getattr(profile, 'telegram_username', None):
            profile.telegram_username = ''
            changed = True
        if changed:
            profile.save(update_fields=['telegram_id', 'telegram_username'])

    return Response({'message': 'Telegram аккаунт успешно отвязан'})


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
        Регистрация на турнир через RegistrationService
        
        POST /api/mini-app/tournaments/{id}/register/
        Body: { "partner_id": 123 }  # опционально, только для парных турниров
        """
        from apps.tournaments.services import RegistrationService
        
        tournament = self.get_object()
        
        if not request.auth or not request.auth.player_id:
            return Response({
                'error': 'Игрок не найден'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            player = Player.objects.get(id=request.auth.player_id)
        except Player.DoesNotExist:
            return Response({
                'error': 'Игрок не найден'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        partner_id = request.data.get('partner_id')
        
        try:
            # Индивидуальный турнир
            if tournament.participant_mode == Tournament.ParticipantMode.SINGLES:
                if partner_id:
                    return Response({
                        'error': 'Для индивидуального турнира нельзя указывать напарника'
                    }, status=status.HTTP_400_BAD_REQUEST)
                
                registration = RegistrationService.register_single(tournament, player)
            
            # Парный турнир
            elif tournament.participant_mode == Tournament.ParticipantMode.DOUBLES:
                if partner_id:
                    # Регистрация с напарником
                    try:
                        partner = Player.objects.get(id=partner_id)
                    except Player.DoesNotExist:
                        return Response({
                            'error': 'Напарник не найден'
                        }, status=status.HTTP_400_BAD_REQUEST)
                    
                    registration = RegistrationService.register_with_partner(
                        tournament, player, partner, notify_partner=True
                    )
                else:
                    # Регистрация в режиме "ищу пару"
                    registration = RegistrationService.register_looking_for_partner(tournament, player)
            
            else:
                return Response({
                    'error': 'Неизвестный тип турнира'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            return Response({
                'message': 'Успешно зарегистрированы на турнир',
                'registration': TournamentRegistrationSerializer(registration).data,
                'tournament': TournamentDetailSerializer(tournament, context={'request': request}).data
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            return Response({
                'error': str(e)
            }, status=status.HTTP_400_BAD_REQUEST)


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
def my_registration(request, tournament_id):
    """
    Получить информацию о своей регистрации на турнир
    
    GET /api/mini-app/tournaments/{id}/my-registration/
    """
    from apps.tournaments.registration_models import TournamentRegistration
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
        registration = TournamentRegistration.objects.get(
            tournament=tournament,
            player_id=telegram_user.player_id
        )
        return Response(TournamentRegistrationSerializer(registration).data)
    except Tournament.DoesNotExist:
        return Response({'error': 'Турнир не найден'}, status=status.HTTP_404_NOT_FOUND)
    except TournamentRegistration.DoesNotExist:
        return Response({'registered': False}, status=status.HTTP_200_OK)


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
    ).select_related('player', 'partner', 'team', 'team__player_1', 'team__player_2').order_by('id')
    
    reserve_list = TournamentRegistration.objects.filter(
        tournament=tournament,
        status=TournamentRegistration.Status.RESERVE_LIST
    ).select_related('player', 'partner', 'team', 'team__player_1', 'team__player_2').order_by('id')
    
    looking_for_partner = TournamentRegistration.objects.filter(
        tournament=tournament,
        status=TournamentRegistration.Status.LOOKING_FOR_PARTNER
    ).select_related('player').order_by('id')
    
    data = {
        'main_list': TournamentRegistrationSerializer(main_list, many=True).data,
        'reserve_list': TournamentRegistrationSerializer(reserve_list, many=True).data,
        'looking_for_partner': TournamentRegistrationSerializer(looking_for_partner, many=True).data,
    }
    
    return Response(data)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_single(request, tournament_id):
    """
    Простая регистрация на турнир (для индивидуальных турниров)
    
    POST /api/mini-app/tournaments/{id}/register-single/
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
        registration = RegistrationService.register_single(tournament, player)
        return Response(
            TournamentRegistrationSerializer(registration).data,
            status=status.HTTP_201_CREATED
        )
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


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
    Body: { "partner_search": "Иванов Иван" }
    """
    from apps.tournaments.services import RegistrationService
    from .api_serializers import RegisterWithPartnerSerializer, TournamentRegistrationSerializer
    from django.db.models import Q
    
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
        
        # Поиск напарника по ФИО
        search_query = serializer.validated_data['partner_search'].strip()
        partners = Player.objects.filter(
            Q(first_name__icontains=search_query) |
            Q(last_name__icontains=search_query) |
            Q(patronymic__icontains=search_query)
        )
        
        if partners.count() == 0:
            return Response({'error': 'Игрок не найден'}, status=status.HTTP_404_NOT_FOUND)
        elif partners.count() > 1:
            # Возвращаем список найденных игроков для уточнения
            return Response({
                'error': 'Найдено несколько игроков. Уточните запрос.',
                'players': [{'id': p.id, 'full_name': p.get_full_name()} for p in partners]
            }, status=status.HTTP_400_BAD_REQUEST)
        
        partner = partners.first()
        
    except Tournament.DoesNotExist:
        return Response({'error': 'Турнир не найден'}, status=status.HTTP_404_NOT_FOUND)
    except Player.DoesNotExist:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_404_NOT_FOUND)
    
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
    Отправить приглашение в пару (поиск по ФИО или по ID)
    
    POST /api/mini-app/tournaments/{id}/send-invitation/
    Body: { "receiver_search": "Иванов Иван", "message": "Давай сыграем!" }
    или
    Body: { "receiver_id": 123, "message": "Давай сыграем!" }
    """
    from apps.tournaments.services import RegistrationService
    from .api_serializers import SendPairInvitationSerializer, PairInvitationSerializer
    from django.db.models import Q
    
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
        sender = Player.objects.get(id=telegram_user.player_id)
        
        # Проверяем, передан ли receiver_id (для списка "Ищут пару")
        receiver_id = request.data.get('receiver_id')
        if receiver_id:
            try:
                receiver = Player.objects.get(id=receiver_id)
            except Player.DoesNotExist:
                return Response({'error': 'Игрок не найден'}, status=status.HTTP_404_NOT_FOUND)
        else:
            # Поиск по ФИО
            serializer = SendPairInvitationSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
            search_query = serializer.validated_data['receiver_search'].strip()
            receivers = Player.objects.filter(
                Q(first_name__icontains=search_query) |
                Q(last_name__icontains=search_query) |
                Q(patronymic__icontains=search_query)
            )
            
            if receivers.count() == 0:
                return Response({'error': 'Игрок не найден'}, status=status.HTTP_404_NOT_FOUND)
            elif receivers.count() > 1:
                # Возвращаем список найденных игроков для уточнения
                return Response({
                    'error': 'Найдено несколько игроков. Уточните запрос.',
                    'players': [{'id': p.id, 'full_name': p.get_full_name()} for p in receivers]
                }, status=status.HTTP_400_BAD_REQUEST)
            
            receiver = receivers.first()
        
    except Tournament.DoesNotExist:
        return Response({'error': 'Турнир не найден'}, status=status.HTTP_404_NOT_FOUND)
    except Player.DoesNotExist:
        return Response({'error': 'Игрок не найден'}, status=status.HTTP_404_NOT_FOUND)
    
    try:
        invitation = RegistrationService.send_pair_invitation(
            tournament, sender, receiver,
            message=request.data.get('message', '')
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
def leave_pair(request, tournament_id):
    """
    Отказаться от текущей пары (оба переходят в "ищу пару")
    
    POST /api/mini-app/tournaments/{id}/leave-pair/
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
        RegistrationService.leave_pair(registration)
        return Response({'message': 'Вы покинули пару'})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([AllowAny])
def cancel_registration(request, tournament_id):
    """
    Полностью отменить регистрацию на турнир (покинуть все списки)
    
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
        return Response({'message': 'Регистрация полностью отменена'})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET'])
@permission_classes([AllowAny])
def search_players(request, tournament_id):
    """
    Поиск игроков для регистрации с напарником
    
    GET /api/mini-app/tournaments/{id}/search-players/?q=Иванов
    """
    from django.db.models import Q
    from apps.tournaments.registration_models import TournamentRegistration
    from apps.telegram_bot.models import TelegramUser
    
    query = request.GET.get('q', '').strip()
    if not query:
        return Response({'players': []})
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
    except Tournament.DoesNotExist:
        return Response({'error': 'Турнир не найден'}, status=status.HTTP_404_NOT_FOUND)
    
    # Ищем игроков по ФИО, у которых есть привязка к Telegram
    telegram_user_ids = TelegramUser.objects.filter(
        player_id__isnull=False
    ).values_list('player_id', flat=True)
    
    players = Player.objects.filter(
        id__in=telegram_user_ids
    ).filter(
        Q(first_name__icontains=query) |
        Q(last_name__icontains=query) |
        Q(patronymic__icontains=query)
    )[:20]  # Ограничиваем 20 результатами
    
    # Проверяем, кто уже зарегистрирован на турнир
    registered_player_ids = set(
        TournamentRegistration.objects.filter(
            tournament=tournament
        ).values_list('player_id', flat=True)
    )
    
    result = []
    for player in players:
        result.append({
            'id': player.id,
            'full_name': str(player),
            'is_registered': player.id in registered_player_ids,
            'rating_bp': player.current_rating if player.current_rating else None
        })
    
    return Response({'players': result})


@api_view(['GET'])
@permission_classes([AllowAny])
def recent_partners(request, tournament_id):
    """
    Получить список рекомендованных напарников (последние и частые)
    
    GET /api/mini-app/tournaments/{id}/recent_partners/
    """
    from django.db.models import Q
    from apps.tournaments.registration_models import TournamentRegistration
    from collections import Counter
    
    # Аутентификация
    auth = TelegramWebAppAuthentication()
    try:
        user, telegram_user = auth.authenticate(request)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_401_UNAUTHORIZED)
    
    if not telegram_user or not telegram_user.player_id:
        return Response({'players': []})
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        current_player = Player.objects.get(id=telegram_user.player_id)
    except (Tournament.DoesNotExist, Player.DoesNotExist):
        return Response({'players': []})
    
    # Собираем всех напарников по командам Team
    teams_with_partner = list(
        Team.objects.filter(
            (Q(player_1=current_player, player_2__isnull=False)) |
            (Q(player_2=current_player, player_1__isnull=False))
        ).order_by('-id')
    )
    
    counter = Counter()
    recent_ids = []
    
    for team in teams_with_partner:
        if team.player_1_id == current_player.id and team.player_2_id:
            partner_id = team.player_2_id
        elif team.player_2_id == current_player.id and team.player_1_id:
            partner_id = team.player_1_id
        else:
            continue
        
        counter[partner_id] += 1
        
        # Формируем список последних напарников (до 3 уникальных)
        if partner_id not in recent_ids:
            recent_ids.append(partner_id)
    
    if not counter:
        return Response({'players': []})
    
    # Top-2 по частоте
    frequent_ids = [pid for pid, _cnt in counter.most_common(2)]
    
    # Объединяем: сначала последние напарники (до 3), затем частые (до 2), без повторов
    merged_ids = []
    for pid in recent_ids[:3]:
        if pid not in merged_ids:
            merged_ids.append(pid)
    for pid in frequent_ids:
        if pid not in merged_ids:
            merged_ids.append(pid)
    
    top_ids = merged_ids[:5]
    
    players_qs = Player.objects.filter(id__in=top_ids)
    players_list = sorted(players_qs, key=lambda p: str(p))
    
    # Помечаем, зарегистрирован ли игрок уже в сформированной паре на этот турнир
    candidate_ids = [p.id for p in players_list]
    base_qs = TournamentRegistration.objects.filter(
        tournament=tournament,
        status__in=[
            TournamentRegistration.Status.MAIN_LIST,
            TournamentRegistration.Status.RESERVE_LIST,
        ],
    )
    
    player_ids = base_qs.filter(player_id__in=candidate_ids).values_list('player_id', flat=True)
    partner_ids = base_qs.filter(partner_id__in=candidate_ids).values_list('partner_id', flat=True)
    registered_ids = set(player_ids) | set(partner_ids)
    
    players_payload = []
    for p in players_list:
        rating = getattr(p, 'current_rating', None)
        rating_bp = int(rating) if rating is not None else None
        players_payload.append({
            'id': p.id,
            'full_name': str(p),
            'is_registered': p.id in registered_ids,
            'rating_bp': rating_bp,
        })
    
    return Response({'players': players_payload})
