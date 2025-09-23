from django.db import migrations, models


TABLE = 'tournaments_tournament'
COLUMN = 'brackets_count'
CHECK_NAME = 'tournaments_tournament_brackets_count_check'


ADD_COLUMN_SQL = f'''
ALTER TABLE "{TABLE}" ADD COLUMN IF NOT EXISTS "{COLUMN}" integer;
ALTER TABLE "{TABLE}" ALTER COLUMN "{COLUMN}" DROP NOT NULL;
ALTER TABLE "{TABLE}" ALTER COLUMN "{COLUMN}" DROP DEFAULT;
'''

DROP_COLUMN_SQL = f'''
ALTER TABLE "{TABLE}" DROP COLUMN IF EXISTS "{COLUMN}";
'''

ADD_CHECK_SQL = f'''
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = '{CHECK_NAME}'
  ) THEN
    ALTER TABLE "{TABLE}"
    ADD CONSTRAINT {CHECK_NAME}
    CHECK (
      (system = 'knockout' AND {COLUMN} >= 1)
      OR
      (system <> 'knockout' AND {COLUMN} IS NULL)
    );
  END IF;
END
$$;
'''

DROP_CHECK_SQL = f'''
ALTER TABLE "{TABLE}" DROP CONSTRAINT IF EXISTS {CHECK_NAME};
'''


class Migration(migrations.Migration):

    dependencies = [
        ('tournaments', '0001_initial'),
    ]

    operations = [
        # Сначала приводим БД к нужному виду (идемпотентно)
        migrations.RunSQL(sql=ADD_COLUMN_SQL, reverse_sql=DROP_COLUMN_SQL),
        migrations.RunSQL(sql=ADD_CHECK_SQL, reverse_sql=DROP_CHECK_SQL),

        # Затем синхронизируем состояние Django-моделей (state) c БД
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AddField(
                    model_name='tournament',
                    name='brackets_count',
                    field=models.IntegerField(null=True, blank=True, verbose_name='Число сеток'),
                ),
            ],
        ),
    ]
