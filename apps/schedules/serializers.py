from rest_framework import serializers

from .models import (
    Schedule,
    ScheduleCourt,
    ScheduleGlobalBreak,
    ScheduleRun,
    ScheduleScope,
    ScheduleSlot,
)


class ScheduleCourtSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduleCourt
        fields = ["id", "index", "name", "first_start_time"]


class ScheduleRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduleRun
        fields = ["id", "index", "start_mode", "start_time", "not_earlier_time"]


class ScheduleSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduleSlot
        fields = [
            "id",
            "run",
            "court",
            "slot_type",
            "match",
            "text_title",
            "text_subtitle",
            "override_title",
            "override_subtitle",
        ]


class ScheduleGlobalBreakSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduleGlobalBreak
        fields = ["id", "position", "time", "text"]


class ScheduleScopeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduleScope
        fields = ["tournament"]


class ScheduleSerializer(serializers.ModelSerializer):
    courts = ScheduleCourtSerializer(many=True, read_only=True)
    runs = ScheduleRunSerializer(many=True, read_only=True)
    slots = ScheduleSlotSerializer(many=True, read_only=True)
    global_breaks = ScheduleGlobalBreakSerializer(many=True, read_only=True)
    scopes = ScheduleScopeSerializer(many=True, read_only=True)

    class Meta:
        model = Schedule
        fields = [
            "id",
            "date",
            "match_duration_minutes",
            "is_draft",
            "created_by",
            "created_at",
            "updated_at",
            "courts",
            "runs",
            "slots",
            "global_breaks",
            "scopes",
        ]
