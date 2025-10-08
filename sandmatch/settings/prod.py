from .base import *  # noqa

DEBUG = False
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# DATABASES, CACHES, STORAGES will be provided via env in MVP1

# Hosts and CORS
ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "*").split(",") if h.strip()]

# In prod explicitly disable allow all and read allowed origins from env
CORS_ALLOW_ALL_ORIGINS = False
_cors = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
if _cors:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in _cors.split(",") if o.strip()]

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
