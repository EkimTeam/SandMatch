from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAdminOrReadOnly(BasePermission):
    """Allow read to anyone (handled by DRF view), write only to ADMIN role or staff."""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if not user or not user.is_authenticated:
            return False
        # staff shortcut
        if getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False):
            return True
        profile = getattr(user, 'profile', None)
        return bool(profile and getattr(profile, 'role', None) == 'ADMIN')
