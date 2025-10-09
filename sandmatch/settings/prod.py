from .base import *  # noqa

DEBUG = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
# Разрешить управлять редиректом на HTTPS через переменную окружения
SECURE_SSL_REDIRECT = os.getenv("DJANGO_SECURE_SSL_REDIRECT", "true").lower() in {"1", "true", "yes"}
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# DATABASES из переменных окружения
# Приоритет: DATABASE_URL (postgres://user:pass@host:port/db?sslmode=require),
# иначе POSTGRES_* переменные как fallback
DATABASES = {}
_db_url = os.getenv("DATABASE_URL", "").strip()
if _db_url:
    from urllib.parse import urlparse, parse_qs

    u = urlparse(_db_url)
    if u.scheme.startswith("postgres"):
        name = (u.path or "/")[1:]  # strip leading '/'
        user = u.username or ""
        password = u.password or ""
        host = u.hostname or ""
        port = int(u.port or 5432)
        qs = parse_qs(u.query or "")
        sslmode = (qs.get("sslmode", [""])[0] or "").lower()
        DATABASES["default"] = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": name,
            "USER": user,
            "PASSWORD": password,
            "HOST": host,
            "PORT": port,
            "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
            "OPTIONS": {**({"sslmode": sslmode} if sslmode else {})},
        }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", "sandmatch"),
            "USER": os.getenv("POSTGRES_USER", "sandmatch"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", ""),
            "HOST": os.getenv("POSTGRES_HOST", "localhost"),
            "PORT": int(os.getenv("POSTGRES_PORT", "5432")),
            "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "60")),
            "OPTIONS": {"sslmode": os.getenv("POSTGRES_SSLMODE", "require")},
        }
    }

# Hosts and CORS/CSRF
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "*").split(",") if h.strip()]

# In prod explicitly disable allow all and read allowed origins from env
CORS_ALLOW_ALL_ORIGINS = False
_cors = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
if _cors:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors.split(",") if o.strip()]

# CSRF trusted origins (CSV: https://example.com,https://www.example.com)
_csrf = os.getenv("CSRF_TRUSTED_ORIGINS", "").strip()
if _csrf:
    CSRF_TRUSTED_ORIGINS = [o.strip() for o in _csrf.split(",") if o.strip()]

# Content Security Policy (baseline, adjust as needed)
CSP_DEFAULT_SRC = ("'self'",)
CSP_SCRIPT_SRC = (
    "'self'",
    "'unsafe-inline'",  # consider removing after inlining is cleaned up
)
CSP_STYLE_SRC = (
    "'self'",
    "'unsafe-inline'",  # Tailwind dev may require this
)
CSP_IMG_SRC = ("'self'", "data:")
CSP_FONT_SRC = ("'self'", "data:")
CSP_CONNECT_SRC = (
    "'self'",
    # API calls to same origin or via reverse proxy
)
CSP_FRAME_ANCESTORS = ("'none'",)
