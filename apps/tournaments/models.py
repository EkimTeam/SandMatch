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
    brackets_count = models.IntegerField("Число сеток", null=True, blank=True)
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
    group_index = models.PositiveSmallIntegerField(default=1)
    row_index = models.PositiveSmallIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tournament", "team"], name="unique_entry_team_in_tournament"),
            models.UniqueConstraint(fields=["tournament", "group_index", "row_index"], name="unique_entry_position"),
        ]
        verbose_name = "Участие в турнире"
        verbose_name_plural = "Участия в турнире"

    def __str__(self) -> str:
        return f"{self.tournament}: {self.team}"


class TournamentEntryStats(models.Model):
    """Денормализованная статистика по участнику турнира для ускорения отрисовки таблиц.

    Обновляется приложением при изменении результатов матчей.
    """
    entry = models.OneToOneField(TournamentEntry, on_delete=models.CASCADE, related_name="stats")
    wins = models.PositiveIntegerField(default=0)
    sets_won = models.PositiveIntegerField(default=0)
    sets_lost = models.PositiveIntegerField(default=0)
    games_won = models.PositiveIntegerField(default=0)
    games_lost = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Статистика участника турнира"
        verbose_name_plural = "Статистики участников турнира"

    def __str__(self) -> str:
        return f"Stats: {self.entry}"


# --- Олимпийская сетка (Knockout) ---
class KnockoutBracket(models.Model):
    """Метаданные одной сетки плей-офф в рамках турнира.

    size — мощность сетки: 8/16/32/64/128
    index — порядковый номер сетки, если их несколько
    """

    tournament = models.ForeignKey(
        Tournament, on_delete=models.CASCADE, related_name="knockout_brackets"
    )
    index = models.PositiveSmallIntegerField()
    size = models.PositiveSmallIntegerField()
    has_third_place = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "index"], name="uniq_knockout_bracket_in_tournament"
            )
        ]
        verbose_name = "Сетка плей-офф"
        verbose_name_plural = "Сетки плей-офф"

    def __str__(self) -> str:
        return f"KO #{self.index} ({self.size}) — {self.tournament}"


class DrawPosition(models.Model):
    """Стартовая позиция участника в первом раунде сетки.

    position — номер ячейки 1..size
    source — источник участника: MAIN|LL|WC|Q|BYE
    seed — посев (может быть null)
    """

    class Source(models.TextChoices):
        MAIN = "MAIN", "Main"
        LL = "LL", "Lucky Loser"
        WC = "WC", "Wild Card"
        Q = "Q", "Qualifier"
        BYE = "BYE", "Bye"

    bracket = models.ForeignKey(
        KnockoutBracket, on_delete=models.CASCADE, related_name="positions"
    )
    position = models.PositiveSmallIntegerField()
    entry = models.ForeignKey(
        TournamentEntry, on_delete=models.SET_NULL, null=True, blank=True, related_name="draw_positions"
    )
    seed = models.PositiveSmallIntegerField(null=True, blank=True)
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.MAIN)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["bracket", "position"], name="uniq_draw_position_in_bracket"
            )
        ]
        verbose_name = "Позиция жеребьёвки"
        verbose_name_plural = "Позиции жеребьёвки"

    def __str__(self) -> str:
        return f"{self.bracket} pos {self.position} ({self.source})"
