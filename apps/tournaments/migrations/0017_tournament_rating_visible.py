from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tournaments", "0016_tournamentannouncementsettings_custom_announcement_text"),
    ]

    operations = [
        migrations.AddField(
            model_name="tournament",
            name="rating_visible",
            field=models.CharField(
                choices=[
                    ("beachplay", "BeachPlay"),
                    ("btr_mw", "РПТТ (м/ж)"),
                    ("btr_mixed", "РПТТ (микст)"),
                    ("btr_under", "РПТТ (юн.)"),
                ],
                db_index=True,
                default="beachplay",
                max_length=16,
            ),
        ),
    ]
