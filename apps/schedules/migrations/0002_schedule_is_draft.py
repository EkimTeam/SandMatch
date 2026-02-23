from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("schedules", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="schedule",
            name="is_draft",
            field=models.BooleanField(default=False),
        ),
    ]
