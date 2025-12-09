"""
Сериализаторы для Telegram Mini App API
"""
from django.db.models import Q
from rest_framework import serializers
from apps.tournaments.models import Tournament, TournamentEntry
from apps.players.models import Player
from apps.teams.models import Team


class TournamentListSerializer(serializers.ModelSerializer):
    """Сериализатор для списка турниров"""
    
    participants_count = serializers.IntegerField(read_only=True)
    is_registered = serializers.SerializerMethodField()
    venue_name = serializers.CharField(source='venue.name', read_only=True)
    
    class Meta:
        model = Tournament
        fields = [
            'id',
            'name',
            'date',
            'status',
            'venue_name',
            'participants_count',
            'max_teams',
            'is_registered',
        ]
    
    def get_is_registered(self, obj):
        """Проверка регистрации текущего пользователя"""
        request = self.context.get('request')
        if not request or not hasattr(request, 'auth'):
            return False
        
        telegram_user = request.auth
        if not telegram_user or not telegram_user.player_id:
            return False
        
        # Проверяем, есть ли команды игрока в турнире
        team_ids = Team.objects.filter(
            Q(player_1_id=telegram_user.player_id) |
            Q(player_2_id=telegram_user.player_id)
        ).values_list('id', flat=True)
        
        return TournamentEntry.objects.filter(
            tournament=obj,
            team_id__in=team_ids
        ).exists()


class TournamentDetailSerializer(serializers.ModelSerializer):
    """Детальная информация о турнире"""
    
    participants_count = serializers.IntegerField(read_only=True)
    is_registered = serializers.SerializerMethodField()
    venue_name = serializers.CharField(source='venue.name', read_only=True)
    venue_address = serializers.CharField(source='venue.address', read_only=True)
    organizer_name = serializers.SerializerMethodField()
    
    class Meta:
        model = Tournament
        fields = [
            'id',
            'name',
            'date',
            'status',
            'venue_name',
            'venue_address',
            'participants_count',
            'max_teams',
            'is_registered',
            'organizer_name',
            'description',
            'entry_fee',
            'prize_fund',
            'system',
        ]
    
    def get_is_registered(self, obj):
        """Проверка регистрации текущего пользователя"""
        request = self.context.get('request')
        if not request or not hasattr(request, 'auth'):
            return False
        
        telegram_user = request.auth
        if not telegram_user or not telegram_user.player_id:
            return False
        
        team_ids = Team.objects.filter(
            Q(player_1_id=telegram_user.player_id) |
            Q(player_2_id=telegram_user.player_id)
        ).values_list('id', flat=True)
        
        return TournamentEntry.objects.filter(
            tournament=obj,
            team_id__in=team_ids
        ).exists()
    
    def get_organizer_name(self, obj):
        """Имя организатора"""
        if obj.organizer:
            return obj.organizer.get_full_name() or obj.organizer.username
        return None


class PlayerSerializer(serializers.ModelSerializer):
    """Сериализатор игрока"""
    
    full_name = serializers.SerializerMethodField()
    
    class Meta:
        model = Player
        fields = [
            'id',
            'full_name',
            'rating',
            'tournaments_played',
            'tournaments_won',
        ]
    
    def get_full_name(self, obj):
        """Полное имя игрока"""
        return f"{obj.first_name} {obj.last_name}".strip()


class TeamSerializer(serializers.ModelSerializer):
    """Сериализатор команды"""
    
    player1 = PlayerSerializer(source='player_1', read_only=True)
    player2 = PlayerSerializer(source='player_2', read_only=True)
    
    class Meta:
        model = Team
        fields = ['id', 'player1', 'player2']


class TournamentRegistrationSerializer(serializers.Serializer):
    """Сериализатор для регистрации на турнир"""
    
    tournament_id = serializers.IntegerField()
    partner_id = serializers.IntegerField(required=False, allow_null=True)
    
    def validate_tournament_id(self, value):
        """Проверка существования турнира"""
        try:
            tournament = Tournament.objects.get(id=value)
            if tournament.status != 'created':
                raise serializers.ValidationError("Регистрация на этот турнир закрыта")
            return value
        except Tournament.DoesNotExist:
            raise serializers.ValidationError("Турнир не найден")
    
    def validate(self, data):
        """Валидация данных регистрации"""
        request = self.context.get('request')
        if not request or not hasattr(request, 'auth'):
            raise serializers.ValidationError("Аутентификация не пройдена")
        
        telegram_user = request.auth
        if not telegram_user or not telegram_user.player_id:
            raise serializers.ValidationError("Игрок не найден")
        
        # Проверяем, не зарегистрирован ли уже
        tournament = Tournament.objects.get(id=data['tournament_id'])
        
        from django.db.models import Q
        
        team_ids = Team.objects.filter(
            Q(player_1_id=telegram_user.player_id) |
            Q(player_2_id=telegram_user.player_id)
        ).values_list('id', flat=True)
        
        if TournamentEntry.objects.filter(
            tournament=tournament,
            team_id__in=team_ids
        ).exists():
            raise serializers.ValidationError("Вы уже зарегистрированы на этот турнир")
        
        return data


class ProfileSerializer(serializers.Serializer):
    """Сериализатор профиля пользователя"""
    
    telegram_id = serializers.IntegerField()
    username = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField(allow_null=True)
    player = PlayerSerializer(allow_null=True)
    is_linked = serializers.BooleanField()
    
    def to_representation(self, instance):
        """Преобразование TelegramUser в представление"""
        return {
            'telegram_id': instance.telegram_id,
            'username': instance.username,
            'first_name': instance.first_name,
            'last_name': instance.last_name,
            'player': PlayerSerializer(instance.player).data if instance.player else None,
            'is_linked': instance.user is not None,
        }
