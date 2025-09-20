from django.db import models

class Match(models.Model):
    class Stage(models.TextChoices):
        GROUP = "group", "Групповой этап"
        PLAYOFF = "playoff", "Плей-офф"
        PLACEMENT = "placement", "Классификация"

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Запланирован"
        LIVE = "live", "Идёт"
        COMPLETED = "completed", "Завершён"
        WALKOVER = "walkover", "Неявка"
        RETIRED = "retired", "Снятие"
        DEFAULT = "default", "Дисквалификация"
    tournament = models.ForeignKey(
        "tournaments.Tournament", on_delete=models.CASCADE, related_name="matches"
    )
    team_1 = models.ForeignKey(
        "teams.Team", on_delete=models.PROTECT, related_name="matches_as_team1"
    )
    team_2 = models.ForeignKey(
        "teams.Team", on_delete=models.PROTECT, related_name="matches_as_team2"
    )
    # Нормализованные ссылки для уникальности пары на уровне БД
    team_low = models.ForeignKey(
        "teams.Team", on_delete=models.PROTECT, related_name="matches_as_team_low", null=True, blank=True
    )
    team_high = models.ForeignKey(
        "teams.Team", on_delete=models.PROTECT, related_name="matches_as_team_high", null=True, blank=True
    )
    winner = models.ForeignKey(
        "teams.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="wins"
    )
    # Структурированное описание раунда/стадии
    stage = models.CharField(max_length=16, choices=Stage.choices, default=Stage.GROUP)
    group_index = models.PositiveSmallIntegerField(null=True, blank=True)
    round_index = models.PositiveSmallIntegerField(null=True, blank=True)
    # Человеко-читаемое имя раунда оставляем для обратной совместимости/отображения
    round_name = models.CharField(max_length=50, blank=True, null=True)
    order_in_round = models.IntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED)
    scheduled_time = models.DateTimeField(blank=True, null=True)
    started_at = models.DateTimeField(blank=True, null=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True, null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["tournament", "round_name", "order_in_round"]),
            models.Index(fields=["tournament", "status"]),
            models.Index(fields=["tournament", "winner"]),
            models.Index(fields=["tournament", "team_low"]),
            models.Index(fields=["tournament", "team_high"]),
            models.Index(fields=["tournament", "stage", "group_index", "round_index", "order_in_round"]),
        ]
        constraints = [
            # Уникальность пары в рамках турнира/стадии/группы (независимо от порядка команд)
            models.UniqueConstraint(
                fields=["tournament", "stage", "group_index", "team_low", "team_high"],
                name="uniq_match_pair_in_stage_group",
            ),
        ]
        verbose_name = "Матч"
        verbose_name_plural = "Матчи"

    def __str__(self) -> str:
        return f"{self.tournament}: {self.team_1} vs {self.team_2}"


class MatchSet(models.Model):
    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name="sets")
    index = models.PositiveSmallIntegerField()  # 1, 2, 3
    games_1 = models.PositiveSmallIntegerField(default=0)
    games_2 = models.PositiveSmallIntegerField(default=0)
    tb_1 = models.PositiveSmallIntegerField(blank=True, null=True)
    tb_2 = models.PositiveSmallIntegerField(blank=True, null=True)
    is_tiebreak_only = models.BooleanField(
        default=False, help_text="Если True — это сет-тайбрейк (например, до 10)"
    )

    class Meta:
        unique_together = (("match", "index"),)
        ordering = ["match", "index"]
        verbose_name = "Сет матча"
        verbose_name_plural = "Сеты матча"

    def __str__(self) -> str:
        if self.is_tiebreak_only:
            if self.tb_1 is not None and self.tb_2 is not None:
                return f"TB({self.tb_1}:{self.tb_2})"
            return "TB"
        s = f"{self.games_1}:{self.games_2}"
        if (self.tb_1 is not None) and (self.tb_2 is not None):
            s += f"({self.tb_1}:{self.tb_2})"
        return s


class MatchSpecialOutcome(models.Model):
    class OutcomeType(models.TextChoices):
        WALKOVER = "walkover", "Неявка"
        RETIRED = "retired", "Снятие"
        DEFAULT = "default", "Дисквалификация"

    match = models.OneToOneField(Match, on_delete=models.CASCADE, related_name="special_outcome")
    type = models.CharField(max_length=16, choices=OutcomeType.choices)
    retired_team = models.ForeignKey(
        "teams.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="retired_in_matches"
    )
    defaulted_team = models.ForeignKey(
        "teams.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="defaulted_in_matches"
    )
    set_number = models.PositiveSmallIntegerField(null=True, blank=True)
    score_at_stop = models.CharField(max_length=20, null=True, blank=True)

    class Meta:
        verbose_name = "Особый исход матча"
        verbose_name_plural = "Особые исходы матча"

    def __str__(self) -> str:
        return f"{self.match} → {self.get_type_display()}"
