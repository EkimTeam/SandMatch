from rest_framework import serializers
from apps.players.models import Player
from apps.teams.models import Team
from apps.matches.models import Match, MatchSet
from apps.accounts.permissions import IsTournamentCreatorOrAdminForDeletion
from .models import Tournament, TournamentEntry, SetFormat, SchedulePattern, Ruleset, TournamentPlacement


class PlayerSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Player
        fields = ["id", "first_name", "last_name", "display_name", "level", "current_rating"]


class TeamSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()
    player_1 = PlayerSerializer(read_only=True)
    player_2 = PlayerSerializer(read_only=True)

    class Meta:
        model = Team
        fields = ["id", "name", "display_name", "full_name", "player_1", "player_2"]

    def get_name(self, obj: Team) -> str:
        return str(obj)

    def get_display_name(self, obj: Team) -> str:
        try:
            if obj.player_2_id:
                dn1 = getattr(obj.player_1, "display_name", None) or str(obj.player_1)
                dn2 = getattr(obj.player_2, "display_name", None) or str(obj.player_2)
                return f"{dn1} / {dn2}".strip()
            # одиночка
            return getattr(obj.player_1, "display_name", None) or str(obj.player_1)
        except Exception:
            return str(obj)

    def get_full_name(self, obj: Team) -> str:
        def full(p):
            if not p:
                return ""
            # Предпочтем last_name + first_name, если доступны
            try:
                return f"{p.last_name} {p.first_name}".strip()
            except Exception:
                return str(p)
        try:
            if obj.player_2_id:
                return f"{full(obj.player_1)} / {full(obj.player_2)}".strip()
            return full(obj.player_1)
        except Exception:
            return str(obj)


class ParticipantSerializer(serializers.ModelSerializer):
    team = TeamSerializer(read_only=True)
    team_id = serializers.IntegerField(write_only=True)
    list_status = serializers.SerializerMethodField()

    class Meta:
        model = TournamentEntry
        fields = [
            "id",
            "team",
            "team_id",
            "group_index",
            "row_index",
            "is_out_of_competition",
            "list_status",
        ]
    
    def get_list_status(self, obj: TournamentEntry) -> str:
        """Определяет статус команды в списках регистрации (main/reserve)"""
        from apps.tournaments.registration_models import TournamentRegistration
        
        # Получаем tournament из контекста или из объекта
        tournament = obj.tournament
        team = obj.team
        
        if not team:
            return "main"  # По умолчанию основной список
        
        # Ищем регистрации игроков этой команды
        player_ids = []
        if team.player_1_id:
            player_ids.append(team.player_1_id)
        if team.player_2_id:
            player_ids.append(team.player_2_id)
        
        if not player_ids:
            return "main"
        
        # Проверяем статус регистрации любого из игроков команды
        registration = TournamentRegistration.objects.filter(
            tournament=tournament,
            player_id__in=player_ids,
            status__in=[
                TournamentRegistration.Status.MAIN_LIST,
                TournamentRegistration.Status.RESERVE_LIST
            ]
        ).first()
        
        if registration:
            if registration.status == TournamentRegistration.Status.MAIN_LIST:
                return "main"
            elif registration.status == TournamentRegistration.Status.RESERVE_LIST:
                return "reserve"
        
        return "main"  # По умолчанию основной список


class MatchSerializer(serializers.ModelSerializer):
    team_1 = TeamSerializer(read_only=True)
    team_2 = TeamSerializer(read_only=True)
    sets = serializers.SerializerMethodField()
    score = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = [
            "id",
            "tournament",
            "bracket",
            "team_1",
            "team_2",
            "winner",
            "stage",
            "group_index",
            "round_index",
            "round_name",
            "order_in_round",
            "is_third_place",
            "status",
            "scheduled_time",
            "started_at",
            "finished_at",
            "sets",
            "score",
            "created_at",
            "updated_at",
        ]

    def get_sets(self, obj: Match):
        # Возвращаем краткое представление сетов для отображения счёта
        # Формат одного сета: { index, games_1, games_2, tb_1, tb_2, is_tiebreak_only }
        items = []
        for s in obj.sets.all():
            items.append(
                {
                    "index": s.index,
                    "games_1": s.games_1,
                    "games_2": s.games_2,
                    "tb_1": s.tb_1,
                    "tb_2": s.tb_2,
                    "is_tiebreak_only": s.is_tiebreak_only,
                }
            )
        return items
    
    def get_score(self, obj: Match):
        # Формируем строку счета для отображения в плитке матча
        if obj.status != Match.Status.COMPLETED:
            return None
        
        winner_id = obj.winner_id
        team1_id = obj.team_1_id
        
        score_parts = []
        for s in obj.sets.all().order_by('index'):
            if s.is_tiebreak_only:
                # Чемпионский тайбрейк: показываем очки TB, а не games (1:0)
                # Ориентируем по победителю
                if winner_id == team1_id:
                    score_parts.append(f"{s.tb_1}:{s.tb_2}TB")
                else:
                    score_parts.append(f"{s.tb_2}:{s.tb_1}TB")
            else:
                # Обычный сет - используем games_1/games_2
                if winner_id == team1_id:
                    g_winner = s.games_1
                    g_loser = s.games_2
                else:
                    g_winner = s.games_2
                    g_loser = s.games_1
                
                # Добавляем тайбрейк если есть
                if s.tb_1 is not None and s.tb_2 is not None:
                    tb_loser = min(s.tb_1, s.tb_2)
                    score_parts.append(f"{g_winner}:{g_loser}({tb_loser})")
                else:
                    score_parts.append(f"{g_winner}:{g_loser}")
        
        return ", ".join(score_parts) if score_parts else None


class TournamentSerializer(serializers.ModelSerializer):
    participants = ParticipantSerializer(source="entries", many=True, read_only=True)
    set_format = serializers.SerializerMethodField()
    matches = MatchSerializer(many=True, read_only=True)
    participants_count = serializers.SerializerMethodField()
    tournament_type = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.SerializerMethodField()
    # Дополнительно для детальной страницы
    date = serializers.DateField(read_only=True)
    start_time = serializers.TimeField(read_only=True)
    system = serializers.CharField(read_only=True)
    participant_mode = serializers.CharField(read_only=True)
    groups_count = serializers.IntegerField(read_only=True)
    get_system_display = serializers.SerializerMethodField()
    get_participant_mode_display = serializers.SerializerMethodField()
    planned_participants = serializers.IntegerField(read_only=True)
    used_player_ids = serializers.SerializerMethodField()
    group_schedule_patterns = serializers.SerializerMethodField()
    king_calculation_mode = serializers.CharField(read_only=True)
    ruleset = serializers.SerializerMethodField()
    organizer_name = serializers.SerializerMethodField()
    organizer_username = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    avg_rating_bp = serializers.SerializerMethodField()
    has_zero_rating_players = serializers.SerializerMethodField()
    rating_coefficient = serializers.FloatField(read_only=True)
    prize_fund = serializers.CharField(read_only=True, allow_blank=True, allow_null=True)
    winner = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = [
            "id",
            "name",
            "date",
            "start_time",
            "system",
            "participant_mode",
            "groups_count",
            "get_system_display",
            "get_participant_mode_display",
            "planned_participants",
            "used_player_ids",
            "group_schedule_patterns",
            "king_calculation_mode",
            "tournament_type",
            "status",
            "set_format",
            "participants",
            "matches",
            "participants_count",
            "created_at",
            "updated_at",
            "ruleset",
            "organizer_name",
            "organizer_username",
            "can_delete",
            "avg_rating_bp",
            "rating_coefficient",
            "prize_fund",
            "winner",
            "has_zero_rating_players",
        ]

    def get_participants_count(self, obj: Tournament) -> int:
        return obj.entries.count()

    def get_tournament_type(self, obj: Tournament) -> str:
        # Маппинг к типам, ожидаемым фронтендом
        return "group" if obj.system == Tournament.System.ROUND_ROBIN else "knockout"

    def get_updated_at(self, obj: Tournament):
        # В модели пока нет updated_at — возвращаем created_at для совместимости
        return obj.created_at

    def get_get_system_display(self, obj: Tournament) -> str:
        return obj.get_system_display()

    def get_get_participant_mode_display(self, obj: Tournament) -> str:
        return obj.get_participant_mode_display()

    def get_used_player_ids(self, obj: Tournament):
        ids = set()
        for e in obj.entries.select_related("team").all():
            if e.team_id:
                if e.team.player_1_id:
                    ids.add(e.team.player_1_id)
                if e.team.player_2_id:
                    ids.add(e.team.player_2_id)
        return sorted(ids)

    def get_group_schedule_patterns(self, obj: Tournament):
        # Гарантируем, что фронтенд получает объект (dict), а не строку
        try:
            val = obj.group_schedule_patterns
            if not val:
                return {}
            if isinstance(val, dict):
                return val
            # На всякий случай: если пришла строка — попробуем распарсить
            import json
            return json.loads(val) if isinstance(val, str) else {}
        except Exception:
            return {}

    def get_set_format(self, obj: Tournament):
        try:
            sf: SetFormat = obj.set_format
            return {
                "name": sf.name,
                "games_to": sf.games_to,
                "tiebreak_at": sf.tiebreak_at,
                "allow_tiebreak_only_set": sf.allow_tiebreak_only_set,
                "max_sets": sf.max_sets,
                "tiebreak_points": sf.tiebreak_points,
                "decider_tiebreak_points": sf.decider_tiebreak_points,
            }
        except Exception:
            return None

    def get_ruleset(self, obj: Tournament):
        try:
            rs: Ruleset = obj.ruleset
            return {
                "id": rs.id,
                "name": rs.name,
                "ordering_priority": rs.ordering_priority,
            }
        except Exception:
            return None

    def get_organizer_name(self, obj: Tournament) -> str:
        user = getattr(obj, "created_by", None)
        if not user:
            return ""
        full_name = f"{user.last_name} {user.first_name}".strip()
        return full_name or getattr(user, "username", "")

    def get_organizer_username(self, obj: Tournament) -> str:
        user = getattr(obj, "created_by", None)
        if not user:
            return ""
        return getattr(user, "username", "") or ""

    def get_can_delete(self, obj: Tournament) -> bool:
        request = self.context.get("request") if hasattr(self, "context") else None
        user = getattr(request, "user", None) if request is not None else None
        if not user or not getattr(user, "is_authenticated", False):
            return False
        try:
            perm = IsTournamentCreatorOrAdminForDeletion()
            return bool(perm.has_object_permission(request, self, obj))
        except Exception:
            return False

    def get_avg_rating_bp(self, obj: Tournament):
        """Рассчитывает средний BP рейтинг участников турнира"""
        from apps.players.models import Player
        
        participants_count = obj.entries.count()
        if participants_count == 0:
            return None
        
        # Собираем ID всех игроков
        player_ids = set()
        for e in obj.entries.select_related("team").only("team_id").all():
            team = getattr(e, "team", None)
            if not team:
                continue
            p1_id = getattr(team, "player_1_id", None)
            p2_id = getattr(team, "player_2_id", None)
            if p1_id:
                player_ids.add(p1_id)
            if p2_id:
                player_ids.add(p2_id)
        
        if not player_ids:
            return None
        
        # Рассчитываем средний рейтинг
        qs = Player.objects.filter(id__in=player_ids).only("id", "current_rating")
        total = 0.0
        cnt = 0
        for p in qs:
            cr = getattr(p, "current_rating", None)
            if cr is not None:
                total += float(cr)
                cnt += 1
        
        if cnt > 0:
            return round(total / cnt, 1)
        return None

    def get_has_zero_rating_players(self, obj: Tournament) -> bool:
        """Проверяет, есть ли среди участников турнира игроки с текущим рейтингом 0."""

        from apps.players.models import Player

        player_ids = set()
        for e in obj.entries.select_related("team").only("team_id").all():
            team = getattr(e, "team", None)
            if not team:
                continue
            p1_id = getattr(team, "player_1_id", None)
            p2_id = getattr(team, "player_2_id", None)
            if p1_id:
                player_ids.add(p1_id)
            if p2_id:
                player_ids.add(p2_id)

        if not player_ids:
            return False

        return Player.objects.filter(id__in=player_ids, current_rating=0).exists()

    def get_winner(self, obj: Tournament):
        """Победитель завершённого турнира для веб-списка турниров.

        Форматирует имя так же, как в Telegram-боте/mini-app:
        "Фамилия Имя" или "Фамилия1 Имя1 / Фамилия2 Имя2".
        """

        if obj.status != Tournament.Status.COMPLETED:
            return None

        placement = (
            TournamentPlacement.objects
            .filter(tournament=obj, place_from=1)
            .select_related("entry__team__player_1", "entry__team__player_2")
            .first()
        )
        if not placement:
            return None

        team = placement.entry.team
        p1 = getattr(team, "player_1", None)
        p2 = getattr(team, "player_2", None)

        def _name(p):
            if not p:
                return str(team)
            last = (getattr(p, "last_name", "") or "").strip()
            first = (getattr(p, "first_name", "") or "").strip()
            base = f"{last} {first}".strip()
            return base or (getattr(p, "display_name", "") or str(team))

        if p1 and p2:
            return f"{_name(p1)} / {_name(p2)}"
        if p1:
            return _name(p1)
        return str(team)


class SchedulePatternSerializer(serializers.ModelSerializer):
    """Сериализатор для шаблонов расписания"""
    
    pattern_type_display = serializers.CharField(source='get_pattern_type_display', read_only=True)
    tournament_system_display = serializers.CharField(source='get_tournament_system_display', read_only=True)
    
    class Meta:
        model = SchedulePattern
        fields = [
            'id',
            'name',
            'pattern_type',
            'pattern_type_display',
            'tournament_system',
            'tournament_system_display',
            'description',
            'participants_count',
            'custom_schedule',
            'is_system',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
