from django import forms


class MatchScoreForm(forms.Form):
    """Простейшая форма ввода счёта для одного сета.

    MVP: только один сет, поля games_1 и games_2. Поле finalize управляет завершением матча.
    """
    games_1 = forms.IntegerField(min_value=0, label="Геймы команды 1", initial=6)
    games_2 = forms.IntegerField(min_value=0, label="Геймы команды 2", initial=4)
    finalize = forms.BooleanField(required=False, initial=True, label="Подтвердить счёт")

    def clean(self):
        cleaned = super().clean()
        g1 = cleaned.get("games_1")
        g2 = cleaned.get("games_2")
        # Базовая валидация MVP: нельзя оба нули, нельзя равенство без тай-брейка
        if g1 is None or g2 is None:
            return cleaned
        if g1 == 0 and g2 == 0:
            raise forms.ValidationError("Счёт не может быть 0:0")
        # В одном сете должен быть победитель
        if g1 == g2:
            raise forms.ValidationError("В одном сете счёт не может быть равным. Укажите победителя.")
        return cleaned
