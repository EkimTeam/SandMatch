from django.core.exceptions import ValidationError
from django.db import models


class SchedulePattern(models.Model):
    """Шаблон расписания для турниров"""

    class PatternType(models.TextChoices):
        BERGER = "berger", "Алгоритм Бергера"
        SNAKE = "snake", "Змейка"
        CUSTOM = "custom", "Кастомный шаблон"

    class TournamentSystem(models.TextChoices):
        ROUND_ROBIN = "round_robin", "Круговая система"
        KNOCKOUT = "knockout", "Олимпийская система"

    name = models.CharField(max_length=100, verbose_name="Название")

    pattern_type = models.CharField(
        max_length=20, choices=PatternType.choices, verbose_name="Тип шаблона"
    )

    tournament_system = models.CharField(
        max_length=20,
        choices=TournamentSystem.choices,
        default=TournamentSystem.ROUND_ROBIN,
        verbose_name="Система турнира",
        help_text="Для какой системы турнира применим этот шаблон",
    )

    description = models.TextField(verbose_name="Описание")

    # Для кастомных шаблонов - обязательно
    participants_count = models.IntegerField(
        null=True,
        blank=True,
        verbose_name="Количество участников",
        help_text="Для кастомных шаблонов - обязательно. Для алгоритмических - не используется",
    )

    # JSON структура для кастомных шаблонов
    custom_schedule = models.JSONField(
        null=True,
        blank=True,
        verbose_name="Кастомное расписание",
        help_text="JSON с описанием туров и пар",
    )

    is_system = models.BooleanField(
        default=True,
        verbose_name="Системный",
        help_text="Системные шаблоны (Berger, Snake) нельзя удалить",
    )

    created_by = models.ForeignKey(
        "auth.User", on_delete=models.SET_NULL, null=True, blank=True, verbose_name="Создал"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Шаблон расписания"
        verbose_name_plural = "Шаблоны расписания"
        ordering = ["tournament_system", "participants_count", "is_system", "name"]
        unique_together = [("name", "tournament_system", "participants_count")]

    def __str__(self):
        if self.pattern_type == self.PatternType.CUSTOM:
            return f"{self.name} ({self.participants_count} участников)"
        return f"{self.name}"

    def clean(self):
        """Валидация шаблона"""
        super().clean()

        # Для кастомных шаблонов обязательны поля
        if self.pattern_type == self.PatternType.CUSTOM:
            if not self.participants_count:
                raise ValidationError(
                    {"participants_count": "Для кастомного шаблона обязательно укажите количество участников"}
                )

            if not self.custom_schedule:
                raise ValidationError({"custom_schedule": "Для кастомного шаблона обязательно укажите расписание"})

            # Валидация структуры кастомного расписания
            self._validate_custom_schedule()

        # Для алгоритмических шаблонов эти поля не нужны
        else:
            if self.custom_schedule:
                raise ValidationError(
                    {"custom_schedule": "Для алгоритмических шаблонов не нужно указывать custom_schedule"}
                )

    def _validate_custom_schedule(self):
        """Проверка корректности кастомного расписания"""
        if not isinstance(self.custom_schedule, dict):
            raise ValidationError({"custom_schedule": "custom_schedule должен быть объектом JSON"})

        rounds = self.custom_schedule.get("rounds")
        if not rounds or not isinstance(rounds, list):
            raise ValidationError({"custom_schedule": 'custom_schedule должен содержать массив "rounds"'})

        n = self.participants_count
        all_participants = set()
        pairs_count = {}

        for round_idx, round_data in enumerate(rounds):
            if not isinstance(round_data, dict):
                raise ValidationError({"custom_schedule": f"Тур {round_idx + 1} должен быть объектом"})

            round_num = round_data.get("round")
            pairs = round_data.get("pairs")

            if not isinstance(pairs, list):
                raise ValidationError({"custom_schedule": f'Тур {round_num}: "pairs" должен быть массивом'})

            round_participants = set()

            for pair_idx, pair in enumerate(pairs):
                if not isinstance(pair, list) or len(pair) != 2:
                    raise ValidationError(
                        {"custom_schedule": f"Тур {round_num}, пара {pair_idx + 1}: должна содержать ровно 2 участника"}
                    )

                p1, p2 = pair

                # Проверка типов
                if not isinstance(p1, int) or not isinstance(p2, int):
                    raise ValidationError(
                        {"custom_schedule": f"Тур {round_num}, пара {pair}: участники должны быть числами"}
                    )

                # Проверка диапазона
                if p1 < 1 or p1 > n or p2 < 1 or p2 > n:
                    raise ValidationError(
                        {"custom_schedule": f"Тур {round_num}, пара {pair}: участники должны быть от 1 до {n}"}
                    )

                # Проверка: участник не играет сам с собой
                if p1 == p2:
                    raise ValidationError(
                        {"custom_schedule": f"Тур {round_num}, пара {pair}: участник не может играть сам с собой"}
                    )

                # Проверка: участник играет максимум 1 матч в туре
                if p1 in round_participants or p2 in round_participants:
                    raise ValidationError(
                        {"custom_schedule": f"Тур {round_num}: участник играет более 1 матча в туре"}
                    )

                round_participants.add(p1)
                round_participants.add(p2)
                all_participants.add(p1)
                all_participants.add(p2)

                # Подсчет пар (нормализованная пара)
                pair_key = tuple(sorted([p1, p2]))
                pairs_count[pair_key] = pairs_count.get(pair_key, 0) + 1

        # Проверка: все участники присутствуют
        expected_participants = set(range(1, n + 1))
        if all_participants != expected_participants:
            missing = expected_participants - all_participants
            raise ValidationError(
                {"custom_schedule": f"Не все участники присутствуют в расписании. Отсутствуют: {sorted(missing)}"}
            )

        # Проверка: каждая пара встречается ровно 1 раз
        for pair, count in pairs_count.items():
            if count != 1:
                raise ValidationError(
                    {"custom_schedule": f"Пара {pair} встречается {count} раз (должна ровно 1 раз)"}
                )

        # Проверка: количество уникальных пар = n*(n-1)/2 (полный круг)
        expected_pairs = n * (n - 1) // 2
        if len(pairs_count) != expected_pairs:
            raise ValidationError(
                {"custom_schedule": f"Количество уникальных пар {len(pairs_count)} != ожидаемому {expected_pairs}"}
            )


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
    
    # JSON структура: {"Группа 1": pattern_id, "Группа 2": pattern_id}
    group_schedule_patterns = models.JSONField(
        default=dict,
        blank=True,
        verbose_name="Шаблоны расписания для групп",
        help_text="Сопоставление названия группы с ID выбранного шаблона расписания"
    )

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
