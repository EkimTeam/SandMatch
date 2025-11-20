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

    q = (request.query_params.get("q") or "").strip()
    try:
        offset = int(request.query_params.get("offset", 0))
    except ValueError:
        offset = 0
    try:
        limit = int(request.query_params.get("limit", 10))
    except ValueError:
        limit = 10

    qs = User.objects.all().select_related("profile").order_by("id")
    if q:
        from django.db.models import Q

        qs = qs.filter(
            Q(username__icontains=q)
            | Q(first_name__icontains=q)
            | Q(last_name__icontains=q)
        )

    total = qs.count()
    users = qs[offset : offset + limit]

    results = []
    for u in users:
        profile = getattr(u, "profile", None)
        results.append(
            {
                "id": u.id,
                "username": u.username,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "full_name": f"{u.last_name} {u.first_name}".strip() or u.username,
                "role": getattr(profile, "role", None),
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
