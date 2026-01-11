from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import UserProfile
from .permissions import IsAdmin, _get_user_role, Role

@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    """Простая регистрация пользователя.

    Ожидает JSON:
    {
      "username": str,
      "password": str,
      "email": str (optional),
      "first_name": str (optional),
      "last_name": str (optional)
    }

    Создаёт django.contrib.auth.User и связанный UserProfile
    с ролью REGISTERED (по умолчанию в модели).
    """

    data = request.data or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip()
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()

    if not username or not password:
        return Response({"detail": "username и password обязательны"}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(username=username).exists():
        return Response({"detail": "Пользователь с таким username уже существует"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password(password)
    except DjangoValidationError as e:
        return Response({"detail": "Недопустимый пароль", "errors": e.messages}, status=status.HTTP_400_BAD_REQUEST)

    user = User.objects.create_user(
        username=username,
        password=password,
        email=email or None,
        first_name=first_name,
        last_name=last_name,
    )

    # Профиль создаётся сигналами, но на всякий случай убедимся, что он есть
    profile, _ = UserProfile.objects.get_or_create(user=user)

    return Response(
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": profile.role,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """Информация о текущем пользователе и его профиле."""

    user: User = request.user
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:  # type: ignore[attr-defined]
        profile = None

    return Response(
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "is_staff": user.is_staff,
            "is_superuser": user.is_superuser,
            "role": getattr(profile, "role", None),
            "player_id": getattr(profile, "player_id", None),
            "telegram_id": getattr(profile, "telegram_id", None),
            "telegram_username": getattr(profile, "telegram_username", None),
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsAdmin])
def users_list(request):
    """Список пользователей для админской страницы смены ролей.

    Поддерживает простейший поиск по username/first_name/last_name (параметр q)
    и пагинацию offset/limit.
    """

    from django.db.models import Q
    from apps.telegram_bot.models import TelegramUser
    
    q = (request.query_params.get("q") or "").strip()
    try:
        offset = int(request.query_params.get("offset", 0))
    except ValueError:
        offset = 0
    try:
        limit = int(request.query_params.get("limit", 10))
    except ValueError:
        limit = 10
    
    # Параметры фильтрации
    role_filter = request.query_params.get("role", "").strip()
    filter_bp = request.query_params.get("filter_bp", "").lower() == "true"
    filter_btr = request.query_params.get("filter_btr", "").lower() == "true"
    filter_telegram = request.query_params.get("filter_telegram", "").lower() == "true"

    qs = User.objects.all().select_related(
        "profile", 
        "profile__player", 
        "profile__player__btr_player",
        "telegram_profile",
        "telegram_profile__player",
        "telegram_profile__player__btr_player"
    ).order_by("id")
    
    if q:
        qs = qs.filter(
            Q(username__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
        )
    
    # Фильтр по роли
    if role_filter:
        qs = qs.filter(profile__role=role_filter)
    
    # Фильтр по BP player (проверяем оба источника)
    if filter_bp:
        qs = qs.filter(
            Q(telegram_profile__player__isnull=False) | Q(profile__player__isnull=False)
        )
    
    # Фильтр по BTR player (проверяем оба источника)
    if filter_btr:
        qs = qs.filter(
            Q(telegram_profile__player__btr_player__isnull=False) | Q(profile__player__btr_player__isnull=False)
        )
    
    # Фильтр по Telegram
    if filter_telegram:
        qs = qs.filter(telegram_profile__isnull=False)

    total = qs.count()
    users = qs[offset : offset + limit]

    results = []
    for u in users:
        profile = getattr(u, "profile", None)
        
        # Проверяем связи
        has_bp_player = False
        has_btr_player = False
        has_telegram = False

        # Проверяем связь с Telegram через TelegramUser
        telegram_user = getattr(u, "telegram_profile", None)
        # has_telegram понимаем как наличие реальной Telegram‑привязки (telegram_id)
        has_telegram = bool(getattr(telegram_user, "telegram_id", None))

        # Проверяем связь с BP игроком
        # Приоритет: TelegramUser.player, затем UserProfile.player
        if telegram_user and telegram_user.player:
            has_bp_player = True
            # Проверяем связь с BTR через player
            has_btr_player = telegram_user.player.btr_player_id is not None
        elif profile and profile.player:
            has_bp_player = True
            # Проверяем связь с BTR через player
            has_btr_player = profile.player.btr_player_id is not None
        
        results.append(
            {
                "id": u.id,
                "username": u.username,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "full_name": f"{u.last_name} {u.first_name}".strip() or u.username,
                "role": getattr(profile, "role", None),
                "has_bp_player": has_bp_player,
                "has_btr_player": has_btr_player,
                "has_telegram": has_telegram,
            }
        )

    has_more = offset + limit < total
    return Response({"results": results, "has_more": has_more, "total": total})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdmin])
def set_user_role(request, user_id: int):
    """Сменить роль пользователя (ADMIN‑ручка).

    Body: { "role": "ADMIN" | "ORGANIZER" | "REFEREE" | "REGISTERED" }
    """

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({"detail": "Пользователь не найден"}, status=status.HTTP_404_NOT_FOUND)

    data = request.data or {}
    new_role = (data.get("role") or "").strip()
    if new_role not in {Role.ADMIN, Role.ORGANIZER, Role.REFEREE, Role.REGISTERED}:
        return Response({"detail": "Некорректная роль"}, status=status.HTTP_400_BAD_REQUEST)

    profile, _ = UserProfile.objects.get_or_create(user=user)
    old_role = profile.role
    if old_role == new_role:
        return Response({"ok": True, "changed": False, "role": profile.role})

    profile.role = new_role
    profile.save(update_fields=["role"])

    return Response({"ok": True, "changed": True, "old_role": old_role, "new_role": new_role})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsAdmin])
def unlink_user_telegram(request, user_id: int):
    """Принудительно отвязать Telegram‑аккаунт от пользователя (ADMIN‑ручка).

    ВАЖНО: не трогаем связь User ↔ Player через TelegramUser.player,
    а только убираем саму Telegram‑привязку (telegram_id / username и профильные поля).
    """

    from apps.telegram_bot.models import TelegramUser

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({"detail": "Пользователь не найден"}, status=status.HTTP_404_NOT_FOUND)

    telegram_user = TelegramUser.objects.filter(user=user).first()
    if not telegram_user or not telegram_user.telegram_id:
        return Response({"detail": "Telegram‑связка для пользователя не найдена"}, status=status.HTTP_404_NOT_FOUND)

    # Удаляем только Telegram‑ID и username, оставляя связь с Player и User
    telegram_user.telegram_id = None
    telegram_user.username = None
    telegram_user.is_blocked = False
    telegram_user.save(update_fields=["telegram_id", "username", "is_blocked"])

    # Очищаем технические поля в UserProfile, если они используются
    profile = getattr(user, "profile", None)
    if profile is not None:
        changed = False
        if getattr(profile, "telegram_id", None) is not None:
            profile.telegram_id = None
            changed = True
        if getattr(profile, "telegram_username", None):
            profile.telegram_username = ""
            changed = True
        if changed:
            profile.save(update_fields=["telegram_id", "telegram_username"])

    return Response({"ok": True})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated, IsAdmin])
def delete_user(request, user_id: int):
    """Каскадно удалить пользователя из системы (ADMIN-ручка).
    
    Удаляет пользователя и все связанные с ним данные.
    """
    
    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({"detail": "Пользователь не найден"}, status=status.HTTP_404_NOT_FOUND)
    
    # Защита от удаления самого себя
    if user.id == request.user.id:
        return Response({"detail": "Нельзя удалить самого себя"}, status=status.HTTP_400_BAD_REQUEST)
    
    username = user.username
    
    # Django автоматически каскадно удалит связанные объекты благодаря on_delete=CASCADE
    user.delete()
    
    return Response({"ok": True, "deleted_username": username})


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset(request):
    """Инициировать сброс пароля.

    В реальном продакшене здесь нужно отправлять email со ссылкой.
    Для dev-окружения возвращаем uid и token, чтобы можно было перейти
    на фронтовую страницу сброса вручную.
    """

    email = (request.data.get("email") or "").strip()
    if not email:
        return Response({"detail": "email обязателен"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        # Не раскрываем, есть ли такой email
        return Response({"detail": "Если такой email существует, инструкции отправлены"})

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)

    return Response({
        "detail": "Инструкции по сбросу отправлены (для dev токен возвращён в ответе)",
        "uid": uid,
        "token": token,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def password_reset_confirm(request):
    """Подтверждение сброса пароля.

    Ожидает JSON: {"uid": str, "token": str, "new_password": str}
    """

    uidb64 = (request.data.get("uid") or "").strip()
    token = (request.data.get("token") or "").strip()
    new_password = request.data.get("new_password") or ""

    if not uidb64 or not token or not new_password:
        return Response({"detail": "uid, token и new_password обязательны"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(pk=uid)
    except (ValueError, User.DoesNotExist, TypeError, OverflowError):
        return Response({"detail": "Неверная или просроченная ссылка сброса"}, status=status.HTTP_400_BAD_REQUEST)

    if not default_token_generator.check_token(user, token):
        return Response({"detail": "Неверный или просроченный токен"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        validate_password(new_password, user=user)
    except DjangoValidationError as e:
        return Response({"detail": "Недопустимый пароль", "errors": e.messages}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save(update_fields=["password"])

    return Response({"detail": "Пароль успешно изменён"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_profile(request):
    """
    Получение профиля текущего пользователя
    
    GET /api/auth/profile/
    """
    from .serializers import UserProfileSerializer
    
    serializer = UserProfileSerializer(request.user)
    return Response(serializer.data)


@api_view(["PUT", "PATCH"])
@permission_classes([IsAuthenticated])
def update_profile(request):
    """
    Обновление профиля текущего пользователя
    
    PUT/PATCH /api/auth/profile/
    """
    from .serializers import UpdateProfileSerializer, UserProfileSerializer
    
    serializer = UpdateProfileSerializer(
        request.user,
        data=request.data,
        partial=request.method == "PATCH"
    )
    
    if serializer.is_valid():
        user = serializer.save()
        return Response(UserProfileSerializer(user).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def unlink_player(request):
    """Отвязать игрока от текущего пользователя (без влияния на Telegram-связь)."""
    from apps.telegram_bot.models import TelegramUser
    from .serializers import UserProfileSerializer

    try:
        telegram_user = TelegramUser.objects.get(user=request.user)
    except TelegramUser.DoesNotExist:
        return Response({"detail": "Telegram профиль не найден"}, status=status.HTTP_404_NOT_FOUND)

    if not telegram_user.player:
        return Response({"detail": "Связь с игроком отсутствует"}, status=status.HTTP_400_BAD_REQUEST)

    telegram_user.player = None
    telegram_user.save(update_fields=["player"])

    return Response(UserProfileSerializer(request.user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    Смена пароля текущего пользователя
    
    POST /api/auth/profile/change-password/
    Body: {
        "old_password": "...",
        "new_password": "...",
        "new_password_confirm": "..."
    }
    """
    from .serializers import ChangePasswordSerializer
    
    serializer = ChangePasswordSerializer(
        data=request.data,
        context={'request': request}
    )
    
    if serializer.is_valid():
        # Устанавливаем новый пароль
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.save()
        
        return Response({
            "detail": "Пароль успешно изменён"
        })
    
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def profile_player_candidates(request):
    """Автоподбор кандидатов Player по ФИО пользователя.

    GET /api/auth/profile/player-candidates/
    """
    from apps.players.models import Player
    from apps.telegram_bot.models import TelegramUser
    from django.db.models import Q

    user = request.user

    # Если уже есть связанный игрок — кандидаты не нужны
    if TelegramUser.objects.filter(user=user, player__isnull=False).exists():
        return Response({"candidates": []})

    first = (user.first_name or "").strip()
    last = (user.last_name or "").strip()
    if not first or not last:
        return Response({"candidates": []})

    qs = Player.objects.filter(
        Q(first_name__iexact=first),
        Q(last_name__iexact=last),
    )

    # Исключаем игроков, уже связанных с кем-то через TelegramUser
    qs = qs.filter(telegram_profile__isnull=True)

    candidates = []
    for p in qs[:10]:
        candidates.append({
            "id": p.id,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "patronymic": p.patronymic or "",
            "city": p.city or "",
            "current_rating": p.current_rating,
        })

    return Response({"candidates": candidates})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def search_players_for_link(request):
    """
    Поиск игроков для связывания с пользователем
    
    GET /api/auth/profile/search-players/?q=Иван+Иванов
    """
    from apps.players.models import Player
    from django.db.models import Q
    
    query = request.GET.get('q', '').strip()
    if not query or len(query) < 2:
        return Response({"players": []})
    
    # Разбиваем запрос на слова (первое слово - имя, второе - фамилия)
    parts = query.split()
    first = parts[0]
    last = parts[1] if len(parts) > 1 else ''
    
    # Ищем по имени и фамилии
    q_filter = Q()
    if first:
        q_filter &= Q(first_name__icontains=first)
    if last:
        q_filter &= Q(last_name__icontains=last)
    
    # Исключаем игроков, уже связанных с кем-то через TelegramUser
    players = Player.objects.filter(q_filter).filter(telegram_profile__isnull=True)[:20]
    
    results = []
    for player in players:
        results.append({
            'id': player.id,
            'first_name': player.first_name,
            'last_name': player.last_name,
            'patronymic': player.patronymic or '',
            'display_name': player.display_name or '',
            'current_rating': player.current_rating,
            'level': player.level or '',
            'city': player.city or '',
            'is_profi': player.is_profi,
        })
    
    return Response({"players": results})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def link_player(request):
    """
    Связывание пользователя с игроком
    
    POST /api/auth/profile/link-player/
    Body: { "player_id": 123 }
    """
    from apps.players.models import Player
    from .serializers import UserProfileSerializer
    
    player_id = request.data.get('player_id')
    if not player_id:
        return Response(
            {"detail": "player_id обязателен"},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    try:
        player = Player.objects.get(id=player_id)
    except Player.DoesNotExist:
        return Response(
            {"detail": "Игрок не найден"},
            status=status.HTTP_404_NOT_FOUND
        )
    
    user = request.user
    
    # Проверяем, не связан ли уже этот User с другим Player и не занят ли выбранный Player
    from apps.telegram_bot.models import TelegramUser

    # 1) выбраный игрок уже связан с кем-то другим
    occupied = TelegramUser.objects.filter(player=player).exclude(user=user).first()
    if occupied:
        return Response(
            {"detail": "Этот игрок уже связан с другим пользователем. Обратись к администратору, если это ошибка."},
            status=status.HTTP_400_BAD_REQUEST
        )
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        if telegram_user.player and telegram_user.player != player:
            return Response(
                {"detail": f"Ты уже связан с игроком {telegram_user.player.first_name} {telegram_user.player.last_name}"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Связываем
        telegram_user.player = player
        telegram_user.save()
    except TelegramUser.DoesNotExist:
        # Создаём TelegramUser без telegram_id (только для связи User-Player)
        TelegramUser.objects.create(
            telegram_id=None,  # Будет установлено при связывании с Telegram
            user=user,
            player=player,
            first_name=user.first_name or '',
            last_name=user.last_name or '',
        )
    
    # Синхронизируем данные User и Player
    if user.first_name:
        player.first_name = user.first_name
    if user.last_name:
        player.last_name = user.last_name
    player.save()
    
    return Response(UserProfileSerializer(user).data)
