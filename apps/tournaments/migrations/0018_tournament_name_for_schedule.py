from django.db import migrations, models


def _fill_name_for_schedule(apps, schema_editor):
    Tournament = apps.get_model("tournaments", "Tournament")
    qs = Tournament.objects.filter(name_for_schedule="")
    for t in qs.only("id").iterator():
        value = f"#{t.id}"
        if len(value) > 10:
            value = value[:10]
        Tournament.objects.filter(id=t.id, name_for_schedule="").update(name_for_schedule=value)


class Migration(migrations.Migration):

    dependencies = [
        ("tournaments", "0017_tournament_rating_visible"),
    ]

    operations = [
        migrations.AddField(
            model_name="tournament",
            name="name_for_schedule",
            field=models.CharField(blank=True, default="", max_length=10),
        ),
        migrations.RunPython(_fill_name_for_schedule, migrations.RunPython.noop),
    ]
