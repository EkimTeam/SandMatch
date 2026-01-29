from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils import timezone
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import UserProfile, PDNActionLog
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
    pdn_consent = bool(data.get("pdn_consent"))

    if not username or not password:
        return Response({"detail": "username и password обязательны"}, status=status.HTTP_400_BAD_REQUEST)

    # Явное согласие на обработку ПДн обязательно при регистрации
    if not pdn_consent:
        return Response({"detail": "Требуется согласие на обработку персональных данных"}, status=status.HTTP_400_BAD_REQUEST)

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
    # Фиксируем факт согласия на обработку ПДн
    profile.pdn_consent_given_at = timezone.now()
    profile.pdn_consent_version = "1.0"
    profile.save(update_fields=["pdn_consent_given_at", "pdn_consent_version"])

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

    # Определяем player_id через TelegramUser, чтобы учитывать новую логику привязки игрока
    telegram_id = getattr(profile, "telegram_id", None)
    telegram_username = getattr(profile, "telegram_username", None)
    player_id = getattr(profile, "player_id", None)

    try:
        from apps.telegram_bot.models import TelegramUser

        tu = (
            TelegramUser.objects.select_related("player")
            .filter(user=user)
            .first()
        )
        if tu and tu.player:
            player_id = tu.player_id
            # Приоритетно берём telegram_id/username из фактической Telegram-связки
            telegram_id = tu.telegram_id
            telegram_username = tu.username
    except Exception:
        # Если модель TelegramUser недоступна или произошла ошибка, тихо игнорируем
        pass

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
            "player_id": player_id,
            "telegram_id": telegram_id,
            "telegram_username": telegram_username,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export_me(request):
    """Выгрузка персональных данных текущего пользователя.

    Возвращает агрегированный JSON с основными данными User, UserProfile
    и связанным Player (через существующие сериализаторы профиля).
    """

    from .serializers import UserProfileSerializer
    from apps.players.models import Player
    from apps.tournaments.registration_models import TournamentRegistration

    user: User = request.user

    try:
        profile = user.profile
    except UserProfile.DoesNotExist:  # type: ignore[attr-defined]
        profile = None

    user_block = UserProfileSerializer(user).data

    profile_block = None
    if profile is not None:
        profile_block = {
            "role": profile.role,
            "telegram_id": getattr(profile, "telegram_id", None),
            "telegram_username": getattr(profile, "telegram_username", None),
            "pdn_consent_given_at": profile.pdn_consent_given_at,
            "pdn_consent_version": profile.pdn_consent_version,
            "created_at": profile.created_at,
            "updated_at": profile.updated_at,
        }

    # Определяем всех игроков, связанных с пользователем
    player_ids = set()

    # 1) Связь через TelegramUser (используется в профиле)
    try:
        from apps.telegram_bot.models import TelegramUser

        tu = TelegramUser.objects.select_related("player").filter(user=user).first()
        if tu and tu.player_id:
            player_ids.add(tu.player_id)
    except Exception:
        pass

    # 2) Связь через UserProfile.player (если используется)
    if profile is not None and getattr(profile, "player_id", None):
        player_ids.add(profile.player_id)  # type: ignore[attr-defined]

    # 3) Игроки, созданные самим пользователем
    created_players = Player.objects.filter(created_by=user).values_list("id", flat=True)
    player_ids.update(created_players)

    tournament_registrations_block = []
    if player_ids:
        regs = (
            TournamentRegistration.objects
            .select_related("tournament", "player", "partner", "team")
            .filter(player_id__in=player_ids)
            .order_by("registered_at")
        )

        for reg in regs:
            t = reg.tournament
            team = reg.team
            tournament_registrations_block.append(
                {
                    "id": reg.id,
                    "tournament": {
                        "id": t.id,
                        "name": t.name,
                        "start_date": t.start_date,
                        "system": t.system,
                    },
                    "player_id": reg.player_id,
                    "partner_id": reg.partner_id,
                    "team_id": team.id if team else None,
                    "status": reg.status,
                    "registered_at": reg.registered_at,
                    "updated_at": reg.updated_at,
                }
            )

    # Логируем факт выгрузки персональных данных
    try:
        PDNActionLog.objects.create(
            user=user,
            action=PDNActionLog.ACTION_EXPORT,
            meta={
                "source": "api",
                "endpoint": "export_me",
                "ip": request.META.get("REMOTE_ADDR"),
                "user_agent": request.META.get("HTTP_USER_AGENT"),
            },
        )
    except Exception:
        # Аудит не должен ломать основной функционал экспорта
        pass

    return Response(
        {
            "user": user_block,
            "profile": profile_block,
            "tournament_registrations": tournament_registrations_block,
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
        has_telegram_profile = False

        # Проверяем связь с Telegram через TelegramUser
        telegram_user = getattr(u, "telegram_profile", None)
        # has_telegram_profile — любая запись TelegramUser, связанная с пользователем
        has_telegram_profile = telegram_user is not None
        # has_telegram — наличие реальной Telegram‑привязки (telegram_id)
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
                "has_telegram_profile": has_telegram_profile,
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

        # Аудит обновления профиля
        try:
            PDNActionLog.objects.create(
                user=user,
                action=PDNActionLog.ACTION_UPDATE_PROFILE,
                meta={
                    "source": "api",
                    "endpoint": "update_profile",
                    "fields": sorted(list((request.data or {}).keys())),
                    "ip": request.META.get("REMOTE_ADDR"),
                    "user_agent": request.META.get("HTTP_USER_AGENT"),
                },
            )
        except Exception:
            # Логирование не должно ломать основной сценарий
            pass

        return Response(UserProfileSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_player_and_link(request):
    """Создать нового игрока и связать его с текущим пользователем."""

    from datetime import date as _date
    from apps.players.models import Player
    from apps.telegram_bot.models import TelegramUser
    from .serializers import UserProfileSerializer

    user = request.user
    data = request.data or {}

    last_name = (data.get("last_name") or "").strip()
    first_name = (data.get("first_name") or "").strip()
    if not last_name or not first_name:
        return Response({"detail": "last_name и first_name обязательны"}, status=status.HTTP_400_BAD_REQUEST)

    # Пользователь может создать только одного игрока
    if Player.objects.filter(created_by=user).exists():
        return Response(
            {
                "detail": "Вы уже создавали игрока. Повторное создание недоступно. Обратитесь к администратору, если нужна помощь.",
                "code": "player_already_created",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    force = bool(data.get("force"))

    # Проверяем наличие похожих игроков (фамилия+имя)
    similar_qs = Player.objects.filter(
        last_name__iexact=last_name,
        first_name__iexact=first_name,
    )

    if similar_qs.exists() and not force:
        tus = TelegramUser.objects.filter(player__in=similar_qs).values("player_id", "user_id")
        by_player_id = {row["player_id"]: row["user_id"] for row in tus}

        similar = []
        for p in similar_qs[:10]:
            linked_user_id = by_player_id.get(p.id)
            similar.append(
                {
                    "id": p.id,
                    "last_name": p.last_name,
                    "first_name": p.first_name,
                    "patronymic": p.patronymic or "",
                    "city": p.city or "",
                    "current_rating": p.current_rating,
                    "is_occupied": linked_user_id is not None,
                }
            )

        return Response(
            {
                "detail": "Найдены игроки с таким же ФИО.",
                "code": "similar_players_found",
                "similar_players": similar,
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Создаём игрока
    player = Player(
        last_name=last_name,
        first_name=first_name,
        patronymic=(data.get("patronymic") or "").strip() or None,
        level=(data.get("level") or "").strip() or None,
        city=(data.get("city") or "").strip(),
        phone=(data.get("phone") or "").strip() or None,
        gender=(data.get("gender") or None) or None,
        created_by=user,
    )

    birth_raw = (data.get("birth_date") or "").strip()
    if birth_raw:
        try:
            player.birth_date = _date.fromisoformat(birth_raw)
        except Exception:
            return Response({"detail": "Некорректная дата рождения"}, status=status.HTTP_400_BAD_REQUEST)

    display_name = (data.get("display_name") or "").strip()
    if display_name:
        player.display_name = display_name

    player.save()

    # Аудит создания игрока пользователем
    try:
        PDNActionLog.objects.create(
            user=user,
            action=PDNActionLog.ACTION_CREATE_PLAYER,
            meta={
                "source": "api",
                "endpoint": "create_player_and_link",
                "player_id": player.id,
                "player_name": str(player),
                "ip": request.META.get("REMOTE_ADDR"),
                "user_agent": request.META.get("HTTP_USER_AGENT"),
            },
        )
    except Exception:
        pass

    # Связываем через TelegramUser
    telegram_user = TelegramUser.objects.filter(user=user).first()
    if telegram_user:
        if telegram_user.player and telegram_user.player != player:
            return Response(
                {
                    "detail": f"Вы уже связаны с игроком {telegram_user.player.first_name} {telegram_user.player.last_name}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        telegram_user.player = player
        telegram_user.save(update_fields=["player"])
    else:
        TelegramUser.objects.create(
            telegram_id=None,
            user=user,
            player=player,
            first_name=user.first_name or "",
            last_name=user.last_name or "",
        )

    return Response(UserProfileSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_player_and_link(request):
    """Создать нового игрока и связать его с текущим пользователем.

    POST /api/auth/profile/create-player-and-link/

    Body: {
      "last_name": str,
      "first_name": str,
      "patronymic"?: str,
      "level"?: str,
      "birth_date"?: "YYYY-MM-DD",
      "phone"?: str,
      "display_name"?: str,
      "city"?: str,
      "gender"?: "male"|"female",
      "force"?: bool  # игнорировать предупреждение о похожих игроках
    }
    """

    from datetime import date as _date
    from django.db.models import Q
    from apps.players.models import Player
    from apps.telegram_bot.models import TelegramUser
    from .serializers import UserProfileSerializer

    user = request.user
    data = request.data or {}

    last_name = (data.get("last_name") or "").strip()
    first_name = (data.get("first_name") or "").strip()
    if not last_name or not first_name:
        return Response({"detail": "last_name и first_name обязательны"}, status=status.HTTP_400_BAD_REQUEST)

    # Пользователь может создать только одного игрока
    if Player.objects.filter(created_by=user).exists():
        return Response(
            {
                "detail": "Вы уже создавали игрока. Повторное создание недоступно. Обратитесь к администратору, если нужна помощь.",
                "code": "player_already_created",
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    force = bool(data.get("force"))

    # Поиск похожих игроков по ФИО
    similar_qs = Player.objects.filter(
        last_name__iexact=last_name,
        first_name__iexact=first_name,
    )

    if similar_qs.exists() and not force:
        tus = (
            TelegramUser.objects.filter(player__in=similar_qs)
            .values("player_id", "user_id")
        )
        by_player_id = {row["player_id"]: row["user_id"] for row in tus}

        similar = []
        for p in similar_qs[:10]:
            linked_user_id = by_player_id.get(p.id)
            similar.append(
                {
                    "id": p.id,
                    "last_name": p.last_name,
                    "first_name": p.first_name,
                    "patronymic": p.patronymic or "",
                    "city": p.city or "",
                    "current_rating": p.current_rating,
                    "is_occupied": linked_user_id is not None,
                }
            )

        return Response(
            {
                "detail": "Найдены игроки с таким же ФИО.",
                "code": "similar_players_found",
                "similar_players": similar,
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Создаём игрока
    player = Player(
        last_name=last_name,
        first_name=first_name,
        patronymic=(data.get("patronymic") or "").strip() or None,
        level=(data.get("level") or "").strip() or None,
        city=(data.get("city") or "").strip(),
        phone=(data.get("phone") or "").strip() or None,
        gender=(data.get("gender") or None) or None,
        created_by=user,
    )

    birth_raw = (data.get("birth_date") or "").strip()
    if birth_raw:
        try:
            player.birth_date = _date.fromisoformat(birth_raw)
        except Exception:
            return Response({"detail": "Некорректная дата рождения"}, status=status.HTTP_400_BAD_REQUEST)

    display_name = (data.get("display_name") or "").strip()
    if display_name:
        player.display_name = display_name

    # current_rating остаётся по умолчанию = 0
    player.save()

    # Линкуем пользователя с созданным игроком
    telegram_user = TelegramUser.objects.filter(user=user).first()
    if telegram_user:
        if telegram_user.player and telegram_user.player != player:
            return Response(
                {
                    "detail": f"Вы уже связаны с игроком {telegram_user.player.first_name} {telegram_user.player.last_name}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        telegram_user.player = player
        telegram_user.save(update_fields=["player"])
    else:
        TelegramUser.objects.create(
            telegram_id=None,
            user=user,
            player=player,
            first_name=user.first_name or "",
            last_name=user.last_name or "",
        )

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

    player = telegram_user.player

    telegram_user.player = None
    telegram_user.save(update_fields=["player"])

    # Аудит отвязки игрока
    try:
        PDNActionLog.objects.create(
            user=request.user,
            action=PDNActionLog.ACTION_UNLINK_PLAYER,
            meta={
                "source": "api",
                "endpoint": "unlink_player",
                "player_id": getattr(player, "id", None),
                "player_name": str(player) if player is not None else None,
                "ip": request.META.get("REMOTE_ADDR"),
                "user_agent": request.META.get("HTTP_USER_AGENT"),
            },
        )
    except Exception:
        pass

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

        # Аудит смены пароля
        try:
            PDNActionLog.objects.create(
                user=request.user,
                action=PDNActionLog.ACTION_CHANGE_PASSWORD,
                meta={
                    "source": "api",
                    "endpoint": "change_password",
                    "ip": request.META.get("REMOTE_ADDR"),
                    "user_agent": request.META.get("HTTP_USER_AGENT"),
                },
            )
        except Exception:
            pass

        return Response({"detail": "Пароль успешно изменён"})
    
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
    Возвращает также флаг is_occupied для игроков, уже связанных с другими аккаунтами.
    """
    from apps.players.models import Player
    from apps.telegram_bot.models import TelegramUser
    from django.db.models import Q
    
    query = request.GET.get('q', '').strip()
    if not query or len(query) < 2:
        return Response({"players": []})

    parts = query.split()

    # Базовый фильтр: одно слово — ищем и по имени, и по фамилии
    if len(parts) == 1:
        term = parts[0]
        q_filter = Q(first_name__icontains=term) | Q(last_name__icontains=term)
    else:
        # Два и более слова — поддерживаем оба порядка: "имя фамилия" и "фамилия имя"
        first = parts[0]
        last = parts[1]

        q_name_first = Q(first_name__icontains=first) & Q(last_name__icontains=last)
        q_name_last = Q(first_name__icontains=last) & Q(last_name__icontains=first)
        q_filter = q_name_first | q_name_last

    players = list(Player.objects.filter(q_filter)[:20])

    # Определяем занятость игроков через TelegramUser
    tus = TelegramUser.objects.filter(player__in=players).values("player_id", "user_id")
    occupied_map = {row["player_id"]: row["user_id"] for row in tus}
    
    results = []
    for player in players:
        linked_user_id = occupied_map.get(player.id)
        is_occupied = linked_user_id is not None and linked_user_id != request.user.id
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
            'is_occupied': is_occupied,
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
    
    # Аудит связывания игрока
    try:
        PDNActionLog.objects.create(
            user=user,
            action=PDNActionLog.ACTION_LINK_PLAYER,
            meta={
                "source": "api",
                "endpoint": "link_player",
                "player_id": player.id,
                "player_name": str(player),
                "ip": request.META.get("REMOTE_ADDR"),
                "user_agent": request.META.get("HTTP_USER_AGENT"),
            },
        )
    except Exception:
        pass

    # Формируем базовый ответ с профилем пользователя
    response_data = UserProfileSerializer(user).data

    # Проверяем расхождение ФИО User и Player.
    # Если фамилия+имя не полностью совпадают, не меняем Player, а возвращаем подробности для диалога на фронте.
    user_first = (user.first_name or "").strip()
    user_last = (user.last_name or "").strip()
    player_first = (player.first_name or "").strip()
    player_last = (player.last_name or "").strip()

    name_mismatch = bool(
        user_first
        and user_last
        and (user_first != player_first or user_last != player_last)
    )

    if name_mismatch:
        # Ищем до 3-х наиболее частых напарников игрока по модели Team
        from collections import Counter
        from django.db.models import Q
        from apps.teams.models import Team

        counter: Counter[int] = Counter()

        teams_with_partner = Team.objects.filter(
            Q(player_1=player, player_2__isnull=False)
            | Q(player_2=player, player_1__isnull=False)
        )

        for team in teams_with_partner:
            if team.player_1_id == player.id and team.player_2_id:
                partner_id = team.player_2_id
            elif team.player_2_id == player.id and team.player_1_id:
                partner_id = team.player_1_id
            else:
                continue

            counter[partner_id] += 1

        top_partners_payload = []
        if counter:
            top_ids = [pid for pid, _ in counter.most_common(3)]
            from apps.players.models import Player as PlayerModel

            partners_by_id = {
                p.id: p for p in PlayerModel.objects.filter(id__in=top_ids)
            }
            for pid in top_ids:
                p_obj = partners_by_id.get(pid)
                if not p_obj:
                    continue
                top_partners_payload.append(
                    {
                        "id": p_obj.id,
                        "full_name": str(p_obj),
                    }
                )

        response_data["name_mismatch"] = {
            "user": {
                "first_name": user_first,
                "last_name": user_last,
            },
            "player": {
                "id": player.id,
                "first_name": player_first,
                "last_name": player_last,
                "top_partners": top_partners_payload,
                "stats_url": f"https://beachplay.ru/players/{player.id}",
            },
        }

    return Response(response_data)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sync_player_name(request):
    """Явная синхронизация ФИО игрока с профилем пользователя.

    POST /api/auth/profile/sync-player-name/
    """

    user = request.user

    from apps.telegram_bot.models import TelegramUser
    from .serializers import UserProfileSerializer

    try:
        telegram_user = TelegramUser.objects.select_related("player").get(user=user)
    except TelegramUser.DoesNotExist:
        return Response(
            {"detail": "Telegram-профиль не найден. Сначала свяжи аккаунт с Telegram."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    player = getattr(telegram_user, "player", None)
    if player is None:
        return Response(
            {"detail": "Профиль не связан с игроком. Сначала выбери игрока."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user_first = (user.first_name or "").strip()
    user_last = (user.last_name or "").strip()
    if not user_first or not user_last:
        return Response(
            {"detail": "Укажи имя и фамилию в профиле пользователя перед синхронизацией."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Обновляем только ФИО игрока
    player.first_name = user_first
    player.last_name = user_last
    player.save(update_fields=["first_name", "last_name"])

    # Аудит действия синхронизации
    try:
        PDNActionLog.objects.create(
            user=user,
            action=PDNActionLog.ACTION_LINK_PLAYER,
            meta={
                "source": "api",
                "endpoint": "sync_player_name",
                "player_id": player.id,
                "player_name": str(player),
                "ip": request.META.get("REMOTE_ADDR"),
                "user_agent": request.META.get("HTTP_USER_AGENT"),
            },
        )
    except Exception:
        pass

    return Response(UserProfileSerializer(user).data)
