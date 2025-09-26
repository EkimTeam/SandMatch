from rest_framework import serializers
from apps.players.models import Player
from apps.teams.models import Team
from apps.matches.models import Match, MatchSet
from .models import Tournament, TournamentEntry


class PlayerSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = Player
        fields = ["id", "first_name", "last_name", "display_name", "level"]


class TeamSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = ["id", "name", "display_name", "full_name", "player_1", "player_2"]
        extra_kwargs = {
            "player_1": {"read_only": True},
            "player_2": {"read_only": True},
        }

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

    class Meta:
        model = TournamentEntry
        fields = [
            "id",
            "team",
            "team_id",
            "group_index",
            "row_index",
            "is_out_of_competition",
        ]


class MatchSerializer(serializers.ModelSerializer):
    team_1 = TeamSerializer(read_only=True)
    team_2 = TeamSerializer(read_only=True)
    sets = serializers.SerializerMethodField()

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


class TournamentSerializer(serializers.ModelSerializer):
    participants = ParticipantSerializer(source="entries", many=True, read_only=True)
    matches = MatchSerializer(many=True, read_only=True)
    participants_count = serializers.SerializerMethodField()
    tournament_type = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.SerializerMethodField()
    # Дополнительно для детальной страницы
    date = serializers.DateField(read_only=True)
    system = serializers.CharField(read_only=True)
    participant_mode = serializers.CharField(read_only=True)
    groups_count = serializers.IntegerField(read_only=True)
    get_system_display = serializers.SerializerMethodField()
    get_participant_mode_display = serializers.SerializerMethodField()
    planned_participants = serializers.IntegerField(read_only=True)
    used_player_ids = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = [
            "id",
            "name",
            "date",
            "system",
            "participant_mode",
            "groups_count",
            "get_system_display",
            "get_participant_mode_display",
            "planned_participants",
            "used_player_ids",
            "tournament_type",
            "status",
            "participants",
            "matches",
            "participants_count",
            "created_at",
            "updated_at",
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
