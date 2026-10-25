"""Django settings. The app is stateless (no database): every request fetches routes and
weather from free public services and computes the assessment in memory."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-key-change-me-in-production")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,.vercel.app").split(",")

INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "routes",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {}
TEMPLATES = []

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True
STATIC_URL = "static/"

CORS_ALLOW_ALL_ORIGINS = True          # read-only public API, no cookies

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
}

CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "routes"},
}

ROUTING = {
    "OSRM_URL": os.environ.get("OSRM_URL", "https://router.project-osrm.org"),
    "NOMINATIM_URL": os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search"),
    "PLACES_URL": os.environ.get("PLACES_URL", "https://geocoding-api.open-meteo.com/v1/search"),
    "WEATHER_URL": os.environ.get("WEATHER_URL", "https://api.open-meteo.com/v1/forecast"),
    "USER_AGENT": os.environ.get("ROUTING_USER_AGENT", "spotter-weather-routes/1.0 (nomanshoukat2003@gmail.com)"),
    "HTTP_TIMEOUT": 30,
    "ROUTE_CACHE_SECONDS": 60 * 60,
    "GEOCODE_CACHE_SECONDS": 60 * 60 * 24,
    "WEATHER_CACHE_SECONDS": 60 * 15,
    "WEATHER_BATCH_SIZE": 100,           # locations per Open-Meteo request
    "WEATHER_PARALLEL": 6,
    "MAX_WEATHER_POINTS": 300,           # corridor points per plan (checkpoints come on top)
    "HEATMAP_HOURS": 48,
}
