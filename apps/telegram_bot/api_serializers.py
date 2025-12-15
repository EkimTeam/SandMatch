"""
Сериализаторы для Telegram Mini App API
"""
from django.db.models import Q
from rest_framework import serializers
from apps.tournaments.models import Tournament, TournamentEntry
from apps.players.models import Player
from apps.teams.models import Team
from apps.matches.models import Match


class TournamentListSerializer(serializers.ModelSerializer):
    """Сериализатор для списка турниров"""
    
    participants_count = serializers.IntegerField(read_only=True)
    is_registered = serializers.SerializerMethodField()
    venue_name = serializers.CharField(source='venue.name', read_only=True)
    # В модели Tournament нет max_teams, используем planned_participants как вместимость
    max_teams = serializers.IntegerField(source='planned_participants', read_only=True)
    start_time = serializers.TimeField(format="%H:%M", allow_null=True, required=False)
    avg_rating_bp = serializers.SerializerMethodField()
    system = serializers.CharField(read_only=True)
    set_format_name = serializers.SerializerMethodField()
    
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
            'start_time',
            'avg_rating_bp',
            'system',
            'set_format_name',
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

    def get_avg_rating_bp(self, obj):
        """Средний рейтинг участников турнира (BP).

        Копируем упрощённую логику из TournamentSerializer.get_avg_rating_bp.
        """
        from apps.players.models import Player

        participants_count = obj.entries.count()
        if participants_count == 0:
            return None

        player_ids = set()
        for e in obj.entries.select_related("team").only("team_id"):
            team = getattr(e, "team", None)
            if not team:
                continue
            if team.player_1_id:
                player_ids.add(team.player_1_id)
            if team.player_2_id:
                player_ids.add(team.player_2_id)

        if not player_ids:
            return None

        qs = Player.objects.filter(id__in=player_ids).only("id", "current_rating")
        total = 0.0
        cnt = 0
        for p in qs:
            cr = getattr(p, "current_rating", None)
            if cr is not None:
                total += float(cr)
                cnt += 1

        if cnt > 0:
            # В Mini App показываем средний рейтинг целым числом
            return int(round(total / cnt))
        return None

    def get_set_format_name(self, obj):
        try:
            sf = obj.set_format
            return sf.name
        except Exception:
            return None


class TournamentDetailSerializer(serializers.ModelSerializer):
    """Детальная информация о турнире"""
    
    participants_count = serializers.IntegerField(read_only=True)
    is_registered = serializers.SerializerMethodField()
    venue_name = serializers.CharField(source='venue.name', read_only=True)
    venue_address = serializers.CharField(source='venue.address', read_only=True)
    organizer_name = serializers.SerializerMethodField()
    # В модели Tournament нет max_teams, используем planned_participants
    max_teams = serializers.IntegerField(source='planned_participants', read_only=True)
    start_time = serializers.TimeField(format="%H:%M", allow_null=True, required=False)
    avg_rating_bp = serializers.SerializerMethodField()
    system = serializers.CharField(read_only=True)
    set_format_name = serializers.SerializerMethodField()
    # Безопасные поля для Mini App: в модели Tournament нет description и entry_fee
    description = serializers.SerializerMethodField()
    entry_fee = serializers.SerializerMethodField()
    
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
            'start_time',
            'avg_rating_bp',
            'system',
            'set_format_name',
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
        # В модели Tournament есть created_by, а не organizer
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None

    def get_avg_rating_bp(self, obj):
        from apps.players.models import Player

        participants_count = obj.entries.count()
        if participants_count == 0:
            return None

        player_ids = set()
        for e in obj.entries.select_related("team").only("team_id"):
            team = getattr(e, "team", None)
            if not team:
                continue
            if team.player_1_id:
                player_ids.add(team.player_1_id)
            if team.player_2_id:
                player_ids.add(team.player_2_id)

        if not player_ids:
            return None

        qs = Player.objects.filter(id__in=player_ids).only("id", "current_rating")
        total = 0.0
        cnt = 0
        for p in qs:
            cr = getattr(p, "current_rating", None)
            if cr is not None:
                total += float(cr)
                cnt += 1

        if cnt > 0:
            # В Mini App показываем средний рейтинг целым числом
            return int(round(total / cnt))
        return None

    def get_set_format_name(self, obj):
        try:
            sf = obj.set_format
            return sf.name
        except Exception:
            return None

    def get_description(self, obj):
        # В текущей модели Tournament нет текстового описания — возвращаем None
        return None

    def get_entry_fee(self, obj):
        # В текущей модели Tournament нет отдельного поля entry_fee — можно брать из prize_fund или вернуть None
        return None


class PlayerSerializer(serializers.ModelSerializer):
    """Сериализатор игрока для Mini App"""

    full_name = serializers.SerializerMethodField()
    rating = serializers.IntegerField(source='current_rating', read_only=True)
    tournaments_played = serializers.SerializerMethodField()
    tournaments_won = serializers.SerializerMethodField()
    matches_played = serializers.SerializerMethodField()

    class Meta:
        model = Player
        fields = [
            'id',
            'full_name',
            'rating',
            'tournaments_played',
            'tournaments_won',
            'matches_played',
        ]

    def get_full_name(self, obj):
        return f"{obj.first_name} {obj.last_name}".strip()

    def get_tournaments_played(self, obj):
        """Количество турниров, в которых игрок участвовал (через команды)."""
        team_ids = Team.objects.filter(
            Q(player_1=obj) | Q(player_2=obj)
        ).values_list('id', flat=True)

        if not team_ids:
            return 0

        return (
            TournamentEntry.objects
            .filter(team_id__in=team_ids)
            .values('tournament_id')
            .distinct()
            .count()
        )

    def get_tournaments_won(self, obj):
        """Количество выигранных матчей игрока (через его команды)."""
        team_ids = Team.objects.filter(
            Q(player_1=obj) | Q(player_2=obj)
        ).values_list('id', flat=True)

        if not team_ids:
            return 0

        return Match.objects.filter(
            winner_id__in=team_ids,
            status=Match.Status.COMPLETED,
        ).count()

    def get_matches_played(self, obj):
        """Количество сыгранных матчей игрока (через его команды)."""
        team_ids = Team.objects.filter(
            Q(player_1=obj) | Q(player_2=obj)
        ).values_list('id', flat=True)

        if not team_ids:
            return 0

        return Match.objects.filter(
            status=Match.Status.COMPLETED,
        ).filter(
            Q(team_1_id__in=team_ids) | Q(team_2_id__in=team_ids)
        ).count()


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


# --- Сериализаторы для регистрации на турниры ---

class TournamentRegistrationSerializer(serializers.Serializer):
    """Сериализатор для регистрации на турнир"""
    
    id = serializers.IntegerField(read_only=True)
    player_id = serializers.IntegerField(source='player.id', read_only=True)
    player_name = serializers.CharField(source='player.full_name', read_only=True)
    partner_id = serializers.IntegerField(source='partner.id', read_only=True, allow_null=True)
    partner_name = serializers.CharField(source='partner.full_name', read_only=True, allow_null=True)
    status = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    registered_at = serializers.DateTimeField(read_only=True)


class PairInvitationSerializer(serializers.Serializer):
    """Сериализатор для приглашения в пару"""
    
    id = serializers.IntegerField(read_only=True)
    sender_id = serializers.IntegerField(source='sender.id', read_only=True)
    sender_name = serializers.CharField(source='sender.full_name', read_only=True)
    receiver_id = serializers.IntegerField(source='receiver.id', read_only=True)
    receiver_name = serializers.CharField(source='receiver.full_name', read_only=True)
    status = serializers.CharField(read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    message = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    responded_at = serializers.DateTimeField(read_only=True, allow_null=True)


class RegisterLookingForPartnerSerializer(serializers.Serializer):
    """Сериализатор для регистрации в режиме 'ищет пару'"""
    pass


class RegisterWithPartnerSerializer(serializers.Serializer):
    """Сериализатор для регистрации с напарником"""
    
    partner_search = serializers.CharField(required=True, help_text="ФИО напарника для поиска")


class SendPairInvitationSerializer(serializers.Serializer):
    """Сериализатор для отправки приглашения в пару"""
    
    receiver_search = serializers.CharField(required=True, help_text="ФИО получателя для поиска")
    message = serializers.CharField(required=False, allow_blank=True, default='')


class TournamentParticipantsSerializer(serializers.Serializer):
    """Сериализатор для списка участников турнира"""
    
    main_list = TournamentRegistrationSerializer(many=True, read_only=True)
    reserve_list = TournamentRegistrationSerializer(many=True, read_only=True)
    looking_for_partner = TournamentRegistrationSerializer(many=True, read_only=True)
