from django.db import models

class Ruleset(models.Model):
    name = models.CharField(max_length=255, unique=True)
    ordering_priority = models.JSONField(help_text="Приоритет критериев сортировки/определения мест")

    class Meta:
        verbose_name = "Регламент"
        verbose_name_plural = "Регламенты"

    def __str__(self) -> str:
        return self.name


class SetFormat(models.Model):
    name = models.CharField(max_length=100, unique=True)
    games_to = models.IntegerField(default=6, help_text="До скольки геймов играется сет")
    tiebreak_at = models.IntegerField(default=6, help_text="Тай-брейк при этом счёте, обычно 6:6")
    allow_tiebreak_only_set = models.BooleanField(
        default=True, help_text="Разрешён ли сет-тайбрейк до 10 как решающий"
    )
    max_sets = models.IntegerField(default=1, help_text="Максимум сетов в матче (1 или 3)")
    tiebreak_points = models.IntegerField(
        default=7, help_text="Очки в обычном тай-брейке (обычно 7)"
    )
    decider_tiebreak_points = models.IntegerField(
        default=10, help_text="Очки в решающем тай-брейке (сет-тайбрейк), обычно 10"
    )

    class Meta:
        verbose_name = "Формат сета"
        verbose_name_plural = "Форматы сетов"

    def __str__(self) -> str:
        return self.name


class Tournament(models.Model):
    class Status(models.TextChoices):
        CREATED = "created", "Создан"
        ACTIVE = "active", "Активен"
        COMPLETED = "completed", "Завершён"

    class System(models.TextChoices):
        ROUND_ROBIN = "round_robin", "Круговая"
        KNOCKOUT = "knockout", "Олимпийка"

    class ParticipantMode(models.TextChoices):
        SINGLES = "singles", "Одиночки"
        DOUBLES = "doubles", "Пары"

    name = models.CharField(max_length=200)
    date = models.DateField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.CREATED)
    system = models.CharField(max_length=16, choices=System.choices)
    participant_mode = models.CharField(
        max_length=16, choices=ParticipantMode.choices, default=ParticipantMode.DOUBLES
    )
    groups_count = models.IntegerField(default=1)
    set_format = models.ForeignKey(SetFormat, on_delete=models.PROTECT)
    ruleset = models.ForeignKey(Ruleset, on_delete=models.PROTECT)
    planned_participants = models.PositiveIntegerField(
        null=True, blank=True, help_text="Планируемое число участников (для UI)")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Турнир"
        verbose_name_plural = "Турниры"

    def __str__(self) -> str:
        return f"{self.name} ({self.date})"


class TournamentEntry(models.Model):
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name="entries")
    team = models.ForeignKey("teams.Team", on_delete=models.CASCADE, related_name="tournament_entries")
    is_out_of_competition = models.BooleanField(default=False, verbose_name="Вне зачёта")

    class Meta:
        unique_together = (("tournament", "team"),)
        verbose_name = "Участие в турнире"
        verbose_name_plural = "Участия в турнире"

    def __str__(self) -> str:
        return f"{self.tournament}: {self.team}"
