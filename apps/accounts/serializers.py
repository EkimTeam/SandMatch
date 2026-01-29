"""
Serializers для профиля пользователя
"""
from rest_framework import serializers
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from apps.players.models import Player


class PlayerProfileSerializer(serializers.ModelSerializer):
    """Serializer для профиля игрока"""
    class Meta:
        model = Player
        fields = [
            'id', 'last_name', 'first_name', 'patronymic',
            'birth_date', 'gender', 'phone', 'display_name', 'city',
            'current_rating', 'level', 'is_profi', 'created_at'
        ]
        read_only_fields = ['id', 'current_rating', 'is_profi', 'created_at']


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer для профиля пользователя"""
    player = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'player']
        read_only_fields = ['id', 'username']
    
    def get_player(self, obj):
        """Получение связанного игрока через TelegramUser"""
        try:
            from apps.telegram_bot.models import TelegramUser
            telegram_user = TelegramUser.objects.select_related('player').get(user=obj)
            if telegram_user.player:
                return PlayerProfileSerializer(telegram_user.player).data
        except TelegramUser.DoesNotExist:
            pass
        return None


class UpdateProfileSerializer(serializers.Serializer):
    """Serializer для обновления профиля"""
    # User fields
    email = serializers.EmailField(required=False)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    
    # Player fields
    patronymic = serializers.CharField(max_length=100, required=False, allow_blank=True)
    birth_date = serializers.DateField(required=False, allow_null=True)
    gender = serializers.ChoiceField(choices=['male', 'female'], required=False, allow_blank=True)
    phone = serializers.CharField(max_length=20, required=False, allow_blank=True)
    display_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    level = serializers.CharField(max_length=50, required=False, allow_blank=True)
    
    def update(self, instance, validated_data):
        """Обновление пользователя и связанного игрока (через TelegramUser)."""
        user = instance

        # Обновляем User
        user.email = validated_data.get('email', user.email)
        user.first_name = validated_data.get('first_name', user.first_name)
        user.last_name = validated_data.get('last_name', user.last_name)
        user.save()

        # Обновляем Player, если есть связанный TelegramUser и у него задан player
        try:
            from apps.telegram_bot.models import TelegramUser

            telegram_user = (
                TelegramUser.objects.select_related('player')
                .get(user=user)
            )
            player = telegram_user.player
            if player is None:
                return user

            player.patronymic = validated_data.get('patronymic', player.patronymic)
            player.birth_date = validated_data.get('birth_date', player.birth_date)
            player.gender = validated_data.get('gender', player.gender)
            player.phone = validated_data.get('phone', player.phone)
            player.display_name = validated_data.get('display_name', player.display_name)
            player.city = validated_data.get('city', player.city)
            player.level = validated_data.get('level', player.level)

            # ВАЖНО: ФИО игрока больше не синхронизируем автоматически с User.
            # Изменение first_name/last_name игрока выполняется только через
            # отдельный endpoint sync_player_name по явному действию пользователя.

            player.save()
        except Exception:
            # Если TelegramUser или Player отсутствуют — просто пропускаем обновление игрока
            pass

        return user


class ChangePasswordSerializer(serializers.Serializer):
    """Serializer для смены пароля"""
    old_password = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(required=True)
    
    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({"new_password_confirm": "Пароли не совпадают"})
        return attrs
    
    def validate_old_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("Неверный текущий пароль")
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    """Serializer для запроса сброса пароля"""
    email = serializers.EmailField(required=True)


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Serializer для подтверждения сброса пароля"""
    token = serializers.CharField(required=True)
    new_password = serializers.CharField(required=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(required=True)
    
    def validate(self, attrs):
        if attrs['new_password'] != attrs['new_password_confirm']:
            raise serializers.ValidationError({"new_password_confirm": "Пароли не совпадают"})
        return attrs
