from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    class Role(models.TextChoices):
        ADMIN = 'ADMIN', 'Admin'
        VIEWER = 'VIEWER', 'Viewer'
        REGISTERED_USER = 'REGISTERED_USER', 'Registered User'

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.ADMIN)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user.username} ({self.role})"
