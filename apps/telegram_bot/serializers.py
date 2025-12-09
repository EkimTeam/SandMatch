"""
Serializers для Telegram Bot API
"""
from rest_framework import serializers
from .models import LinkCode, TelegramUser


class LinkCodeSerializer(serializers.ModelSerializer):
    """Serializer для кодов связывания"""
    expires_in_minutes = serializers.SerializerMethodField()
    
    class Meta:
        model = LinkCode
        fields = ['code', 'created_at', 'expires_at', 'expires_in_minutes']
        read_only_fields = ['code', 'created_at', 'expires_at']
    
    def get_expires_in_minutes(self, obj):
        """Сколько минут осталось до истечения"""
        from django.utils import timezone
        delta = obj.expires_at - timezone.now()
        return max(0, int(delta.total_seconds() / 60))


class TelegramUserSerializer(serializers.ModelSerializer):
    """Serializer для Telegram пользователей"""
    is_linked = serializers.SerializerMethodField()
    
    class Meta:
        model = TelegramUser
        fields = ['telegram_id', 'username', 'first_name', 'is_linked', 'created_at']
        read_only_fields = fields
    
    def get_is_linked(self, obj):
        """Проверка, связан ли аккаунт"""
        return obj.user is not None
