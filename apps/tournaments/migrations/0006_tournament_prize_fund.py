# Generated manually

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tournaments', '0005_tournament_created_by_tournament_is_rating_calc_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='tournament',
            name='prize_fund',
            field=models.CharField(
                blank=True,
                help_text="Наличие и размер призового фонда (например: '50000 руб', '1000 USD')",
                max_length=100,
                null=True,
                verbose_name='Призовой фонд'
            ),
        ),
    ]
