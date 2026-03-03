from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tournaments", "0015_tournament_stage_name_tournament_stage_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="tournamentannouncementsettings",
            name="custom_announcement_text",
            field=models.TextField(blank=True, default="", verbose_name="Кастомный текст анонса"),
        ),
    ]
