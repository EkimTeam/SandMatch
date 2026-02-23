from django.conf import settings
from django.db import models

from apps.matches.models import Match
from apps.tournaments.models import Tournament


class Schedule(models.Model):
    date = models.DateField()
    match_duration_minutes = models.PositiveSmallIntegerField(default=40)
    is_draft = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_schedules",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]


class ScheduleScope(models.Model):
    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="scopes")
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="schedule_scopes")

    class Meta:
        unique_together = ("schedule", "tournament")


class ScheduleCourt(models.Model):
    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="courts")
    index = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=128)
    first_start_time = models.TimeField(null=True, blank=True)

    class Meta:
        unique_together = ("schedule", "index")
        ordering = ["index"]


class ScheduleRun(models.Model):
    class StartMode(models.TextChoices):
        FIXED = "fixed", "fixed"
        THEN = "then", "then"
        NOT_EARLIER = "not_earlier", "not_earlier"

    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="runs")
    index = models.PositiveSmallIntegerField()
    start_mode = models.CharField(max_length=16, choices=StartMode.choices, default=StartMode.FIXED)
    start_time = models.TimeField(null=True, blank=True)
    not_earlier_time = models.TimeField(null=True, blank=True)

    class Meta:
        unique_together = ("schedule", "index")
        ordering = ["index"]


class ScheduleSlot(models.Model):
    class SlotType(models.TextChoices):
        MATCH = "match", "match"
        TEXT = "text", "text"

    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="slots")
    run = models.ForeignKey(ScheduleRun, on_delete=models.CASCADE, related_name="slots")
    court = models.ForeignKey(ScheduleCourt, on_delete=models.CASCADE, related_name="slots")

    slot_type = models.CharField(max_length=16, choices=SlotType.choices)
    match = models.ForeignKey(Match, null=True, blank=True, on_delete=models.SET_NULL, related_name="schedule_slots")

    text_title = models.CharField(max_length=256, null=True, blank=True)
    text_subtitle = models.TextField(null=True, blank=True)

    override_title = models.CharField(max_length=256, null=True, blank=True)
    override_subtitle = models.TextField(null=True, blank=True)

    class Meta:
        unique_together = ("schedule", "run", "court")


class ScheduleGlobalBreak(models.Model):
    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="global_breaks")
    position = models.PositiveSmallIntegerField()
    time = models.TimeField()
    text = models.CharField(max_length=256)

    class Meta:
        ordering = ["position"]
