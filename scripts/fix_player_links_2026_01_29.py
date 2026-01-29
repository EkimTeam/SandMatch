from django.contrib.auth.models import User
from django.apps import apps
from django.db import transaction

from apps.players.models import Player
from apps.telegram_bot.models import TelegramUser

# ====== ПАРАМЕТРЫ ДЛЯ КОНКРЕТНОГО СЛУЧАЯ ======
PLAYER1_ID = 5    # правильный игрок для Игрок1
PLAYER2_ID = 25   # «испорченный» игрок, которому надо вернуть ФИО
PLAYER3_ID = 139  # лишний игрок, который должен быть удалён

USER1_ID = 25     # аккаунт Игрок1
USER2_ID = 27     # аккаунт Игрок2

CORRECT_FIRST_NAME_2 = "Полина"
CORRECT_LAST_NAME_2 = "Солдатенкова"

# Режим сухого прогона: True -> только печатаем, False -> реально меняем БД
DRY_RUN = True
# ============================================


@transaction.atomic
def main():
    print("=== FIX PLAYER LINKS (DRY_RUN =", DRY_RUN, ") ===")

    print("Загружаем объекты...")
    p1 = Player.objects.select_for_update().get(id=PLAYER1_ID)
    p2 = Player.objects.select_for_update().get(id=PLAYER2_ID)
    p3 = Player.objects.select_for_update().get(id=PLAYER3_ID)

    u1 = User.objects.get(id=USER1_ID)
    u2 = User.objects.get(id=USER2_ID)

    tu1 = TelegramUser.objects.select_for_update().get(user=u1)
    tu2 = TelegramUser.objects.select_for_update().get(user=u2)

    print(f"Игрок1:  User#{u1.id}, Player#{p1.id} ({p1})")
    print(f"Игрок2:  Player#{p2.id} ({p2})")
    print(f"Игрок3:  Player#{p3.id} ({p3})")
    print(f"TU1:     {tu1} (player_id={tu1.player_id})")
    print(f"TU2:     {tu2} (player_id={tu2.player_id})")

    # 1. USER1 -> PLAYER1
    print("\n[1] Привязка USER1 -> PLAYER1")
    print(f"  Сейчас: TelegramUser1.player_id = {tu1.player_id}")
    print(f"  Будет:  TelegramUser1.player_id = {p1.id}")
    if not DRY_RUN:
        tu1.player = p1
        tu1.save(update_fields=["player"])

    # 2. ФИО PLAYER2
    print("\n[2] Восстановление ФИО для PLAYER2")
    print(f"  Сейчас: {p2.last_name} {p2.first_name}")
    print(f"  Будет:  {CORRECT_LAST_NAME_2} {CORRECT_FIRST_NAME_2}")
    if not DRY_RUN:
        p2.first_name = CORRECT_FIRST_NAME_2
        p2.last_name = CORRECT_LAST_NAME_2
        p2.save(update_fields=["first_name", "last_name"])

    # 3. USER2 -> PLAYER2
    print("\n[3] Привязка USER2 -> PLAYER2 вместо PLAYER3")
    print(f"  Сейчас: TelegramUser2.player_id = {tu2.player_id}")
    print(f"  Будет:  TelegramUser2.player_id = {p2.id}")
    if not DRY_RUN:
        tu2.player = p2
        tu2.save(update_fields=["player"])

    # 4. Перевешиваем внешние ключи с PLAYER3 на PLAYER2
    print("\n[4] Поиск всех FK на Player, указывающих на PLAYER3...")
    PlayerModel = Player
    updated_total = 0

    for model in apps.get_models():
        for field in model._meta.get_fields():
            if not getattr(field, "many_to_one", False):
                continue
            if field.remote_field and field.remote_field.model is PlayerModel:
                fk_name = field.name
                qs = model.objects.filter(**{fk_name: p3})
                count = qs.count()
                if count:
                    print(f"  - {model.__name__}.{fk_name}: {count} записей → PLAYER2")
                    updated_total += count
                    if not DRY_RUN:
                        qs.update(**{fk_name: p2})

    print(f"Всего ссылок с PLAYER3 на PLAYER2: {updated_total}")

    print("\n[5] Удаление PLAYER3")
    print(f"  Сейчас: Player#{p3.id} ({p3}) будет удалён")
    if not DRY_RUN:
        p3.delete()
        print("  PLAYER3 удалён.")
    else:
        print("  DRY_RUN=True — удаление НЕ выполняется.")

    if DRY_RUN:
        print("\nDRY_RUN=True — все изменения только напечатаны, транзакция будет откатана.")
        raise SystemExit(0)  # Явно выходим, Django откатит транзакцию
    else:
        print("\nГОТОВО. Изменения будут зафиксированы.")


if __name__ == "__main__":
    main()