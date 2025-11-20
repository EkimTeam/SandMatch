from rest_framework.permissions import BasePermission, SAFE_METHODS


class Role:
    """Утилитарный перечислитель ролей, синхронизированный с UserProfile.Role."""

    ADMIN = "ADMIN"
    ORGANIZER = "ORGANIZER"
    REFEREE = "REFEREE"
    REGISTERED = "REGISTERED"


def _get_user_role(user):
    """Безопасно получить роль пользователя из профиля."""

    profile = getattr(user, "profile", None)
    return getattr(profile, "role", None) if profile is not None else None


class IsAdminOrReadOnly(BasePermission):
    """Чтение всем, запись только ADMIN/staff.

    Оставлено для обратной совместимости, но DELETE больше не открываем всем.
    """

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True

        user = request.user
        if not user or not user.is_authenticated:
            return False

        # staff / superuser
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True

        return _get_user_role(user) == Role.ADMIN


class IsAuthenticatedAndRoleIn(BasePermission):
    """Проверка, что пользователь аутентифицирован и его роль в списке allowed_roles."""

    def __init__(self, *allowed_roles):
        self.allowed_roles = set(allowed_roles)

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        role = _get_user_role(user)
        return role in self.allowed_roles


class IsAdmin(BasePermission):
    """Роль ADMIN или staff/superuser."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True
        return _get_user_role(user) == Role.ADMIN


class IsTournamentCreatorOrAdmin(BasePermission):
    """Создатель турнира или ADMIN/staff.

    Ожидает, что view.get_object() вернёт Tournament.
    """

    def has_permission(self, request, view):
        # Для object-level проверок DRF сначала вызывает has_permission, затем has_object_permission.
        # Здесь достаточно базовой аутентификации; детальную проверку делаем на объекте.
        user = request.user
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        # staff / superuser всегда могут
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True

        role = _get_user_role(user)
        if role == Role.ADMIN:
            return True

        created_by = getattr(obj, "created_by", None)
        return bool(created_by and created_by_id_equals_user(created_by, user))


def created_by_id_equals_user(created_by, user):
    """Хелпер для безопасного сравнения creator с текущим пользователем по id.

    Вынесен отдельно, чтобы избежать импорта User внутри классов.
    """

    return getattr(created_by, "id", None) == getattr(user, "id", None)


class IsTournamentCreatorOrAdminForDeletion(BasePermission):
    """Разрешение для удаления турниров.
    
    Разрешено для:
    - ADMIN - может удалять любые турниры
    - staff/superuser - может удалять любые турниры  
    - Создатель турнира - может удалять только свои турниры если их статус не completed
    """

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        # staff / superuser всегда могут
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True

        role = _get_user_role(user)
        if role == Role.ADMIN:
            return True

        # Создатель может удалять только свои незавершенные турниры
        created_by = getattr(obj, "created_by", None)
        if created_by and created_by_id_equals_user(created_by, user):
            # Проверяем статус турнира
            tournament_status = getattr(obj, "status", None)
            return tournament_status != "completed"

        return False


class IsRefereeForTournament(BasePermission):
    """Проверка, что пользователь назначен рефери в tournament.referees."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        # ADMIN / staff считаем прошедшими эту проверку, чтобы не дублировать логику
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True
        if _get_user_role(user) == Role.ADMIN:
            return True

        referees = getattr(obj, "referees", None)
        if referees is None:
            return False
        return referees.filter(id=getattr(user, "id", None)).exists()
