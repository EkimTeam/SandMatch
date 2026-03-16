from rest_framework import serializers

from .models import (
    Schedule,
    ScheduleCourt,
    ScheduleGlobalBreak,
    ScheduleRun,
    ScheduleWave,
    ScheduleScope,
    ScheduleScopeCourt,
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
    bound_courts = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleScope
        fields = ["id", "tournament", "wave", "order", "start_mode", "start_time", "bound_courts"]

    def get_bound_courts(self, obj: ScheduleScope):
        try:
            rel = getattr(obj, "bound_courts", None)
            if not rel:
                return []
            return [int(x.court_id) for x in rel.all()]
        except Exception:
            return []


class ScheduleSerializer(serializers.ModelSerializer):
    courts = ScheduleCourtSerializer(many=True, read_only=True)
    runs = ScheduleRunSerializer(many=True, read_only=True)
    slots = ScheduleSlotSerializer(many=True, read_only=True)
    global_breaks = ScheduleGlobalBreakSerializer(many=True, read_only=True)
    waves = serializers.SerializerMethodField()
    scopes = ScheduleScopeSerializer(many=True, read_only=True)

    def get_waves(self, obj: Schedule):
        try:
            waves = getattr(obj, "waves", None)
            if not waves:
                return []
            items = []
            for w in waves.all().order_by("order", "id"):
                items.append(
                    {
                        "id": int(w.id),
                        "order": int(w.order or 0),
                        "start_mode": str(w.start_mode),
                        "start_time": w.start_time.strftime("%H:%M") if getattr(w, "start_time", None) else None,
                        "earliest_time": w.earliest_time.strftime("%H:%M") if getattr(w, "earliest_time", None) else None,
                    }
                )
            return items
        except Exception:
            return []

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
            "waves",
            "scopes",
        ]
