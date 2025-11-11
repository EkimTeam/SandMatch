from .base import *  # noqa

DEBUG = True

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "sandmatch"),
        "USER": os.getenv("POSTGRES_USER", "sandmatch"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "sandmatch"),
        "HOST": os.getenv("POSTGRES_HOST", "localhost"),
        "PORT": int(os.getenv("POSTGRES_PORT", "5432")),
        "OPTIONS": {
            "client_encoding": "UTF8",
        },
    }
}
