# Миграция: разрешить NULL для team_1 и team_2 в матчах (для плей-офф)
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("matches", "0003_link_bracket_state"),
        ("teams", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="match",
            name="team_1",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="matches_as_team1",
                to="teams.team",
            ),
        ),
        migrations.AlterField(
            model_name="match",
            name="team_2",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="matches_as_team2",
                to="teams.team",
            ),
        ),
    ]
