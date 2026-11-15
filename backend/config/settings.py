"""
Configuration du projet.

Les secrets et les réglages d'environnement viennent du fichier .env (non versionné, voir
.env.example). Les textes, coordonnées et réglages du site sont dans l'admin (« Paramètres du site »).
"""
import json
import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')


def env(nom, defaut=None, obligatoire=False):
    valeur = os.environ.get(nom, '').strip()
    if valeur:
        return valeur
    if obligatoire:
        raise ImproperlyConfigured(
            f"La variable d'environnement {nom} est obligatoire : copiez .env.example vers .env et renseignez-la.")
    return defaut


def env_bool(nom, defaut=False):
    valeur = env(nom)
    return defaut if valeur is None else valeur.lower() in ('1', 'true', 'oui', 'yes', 'on')


def env_int(nom, defaut):
    valeur = env(nom)
    try:
        return int(valeur) if valeur is not None else defaut
    except ValueError:
        raise ImproperlyConfigured(f'{nom} doit être un nombre entier.')


# --- Sécurité ---
SECRET_KEY = env('DJANGO_SECRET_KEY', obligatoire=True)
DEBUG = env_bool('DJANGO_DEBUG', False)
ALLOWED_HOSTS = [h.strip() for h in env('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]

# --- Applications ---
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'ticketing',
    'compte',
]

AUTH_USER_MODEL = 'ticketing.Utilisateur'   # connexion par e-mail

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.locale.LocaleMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'ticketing.context.site',
                'compte.context.verification',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# --- Base de données ---
if env('DB_ENGINE', 'sqlite3') == 'postgresql':
    DATABASES = {'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME', obligatoire=True), 'USER': env('DB_USER', ''), 'PASSWORD': env('DB_PASSWORD', ''),
        'HOST': env('DB_HOST', 'localhost'), 'PORT': env('DB_PORT', '5432'),
    }}
else:
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / env('DB_NAME', 'db.sqlite3')}}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# --- Langue et heure ---
LANGUAGE_CODE = 'fr-fr'
TIME_ZONE = 'Europe/Paris'     # fuseau d'affichage par défaut ; les dates sont stockées en UTC
USE_I18N = True
USE_TZ = True

# --- Fichiers statiques (CSS, JS, polices) et médias (images téléversées dans l'admin) ---
STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'assets']
MEDIA_URL = env('MEDIA_URL', 'media/')
MEDIA_ROOT = BASE_DIR / env('MEDIA_DIR', 'media')


def _options_stockage():
    """Options du stockage des images (JSON dans MEDIA_STORAGE_OPTIONS), pour un stockage externe en production."""
    brut = env('MEDIA_STORAGE_OPTIONS', '{}')
    try:
        options = json.loads(brut)
    except ValueError:
        raise ImproperlyConfigured('MEDIA_STORAGE_OPTIONS doit contenir du JSON valide.')
    return options


# Stockage des images téléversées. En développement : fichiers locaux (MEDIA_ROOT). En production, on peut
# viser un stockage externe sans changer le code, par exemple django-storages (à installer) :
#   MEDIA_STORAGE_BACKEND=storages.backends.s3.S3Storage
#   MEDIA_STORAGE_OPTIONS={"bucket_name": "...", "region_name": "...", "default_acl": "public-read"}
STORAGES = {
    'default': {'BACKEND': env('MEDIA_STORAGE_BACKEND', 'django.core.files.storage.FileSystemStorage'), 'OPTIONS': _options_stockage()},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}

# --- Images : limites à l'upload et versions générées (voir ticketing/images.py) ---
IMAGE_FORMATS_AUTORISES = ('JPEG', 'PNG', 'WEBP')
IMAGE_TAILLE_MAX_MO = env_int('IMAGE_TAILLE_MAX_MO', 5)         # poids maximum d'une image
IMAGE_LARGEUR_MIN = env_int('IMAGE_LARGEUR_MIN', 600)           # dimensions minimales, en pixels
IMAGE_HAUTEUR_MIN = env_int('IMAGE_HAUTEUR_MIN', 400)
IMAGE_PIXELS_MAX = env_int('IMAGE_PIXELS_MAX', 40_000_000)      # protège le serveur des images gigantesques
IMAGE_LARGEURS = {'miniature': 320, 'moyenne': 800, 'grande': 1600}   # largeurs des versions WebP
IMAGE_QUALITE_WEBP = env_int('IMAGE_QUALITE_WEBP', 82)

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# --- E-mail : console en développement, SMTP en production ---
EMAIL_BACKEND = env('EMAIL_BACKEND') or (
    'django.core.mail.backends.console.EmailBackend' if DEBUG else 'django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = env('EMAIL_HOST', '')
EMAIL_PORT = env_int('EMAIL_PORT', 587)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = env_bool('EMAIL_USE_TLS', True)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', '')

# --- Paiement : sans secret, le webhook est désactivé ---
PAYMENT_WEBHOOK_SECRET = env('PAYMENT_WEBHOOK_SECRET', '')

# --- Règles métier (valeurs par défaut sûres, surchargeables dans .env) ---
DUREES_RETENUE_MINUTES = {
    'carte': env_int('RETENUE_CARTE_MINUTES', 15),
    'virement': env_int('RETENUE_VIREMENT_MINUTES', 48 * 60),
}
MAX_PLACES_PAR_COMMANDE = env_int('MAX_PLACES_PAR_COMMANDE', 10)

# --- Connexion, sessions et limitation des tentatives ---
LOGIN_URL = 'compte:connexion'
LOGIN_REDIRECT_URL = 'compte:mes_billets'   # destination par défaut après connexion
LOGOUT_REDIRECT_URL = 'accueil'
CONNEXION_TENTATIVES_MAX = env_int('CONNEXION_TENTATIVES_MAX', 5)          # échecs autorisés…
CONNEXION_FENETRE_MINUTES = env_int('CONNEXION_FENETRE_MINUTES', 15)       # …par adresse IP + e-mail, sur cette durée
SESSION_COOKIE_AGE = env_int('SESSION_DUREE_JOURS', 30) * 24 * 3600        # durée avec « Rester connecté »
SESSION_COOKIE_SECURE = not DEBUG        # cookies de session et CSRF en HTTPS seulement en production
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True

# Les cookies ne sont PAS séparés par numéro de port : deux projets Django lancés en local sur 127.0.0.1 (même sur des
# ports différents) se partagent un cookie « csrftoken » et un cookie « sessionid », et s'écrasent l'un l'autre
# (erreur 403 CSRF, déconnexions surprises). On donne donc à ce projet des noms de cookie à lui.
_PREFIXE_COOKIE = env('COOKIE_PREFIXE', 'billetterie')
CSRF_COOKIE_NAME = f'{_PREFIXE_COOKIE}_csrftoken'
SESSION_COOKIE_NAME = f'{_PREFIXE_COOKIE}_sessionid'

# Jeton CSRF périmé (page restée ouverte, autre onglet…) : une page claire plutôt que l'erreur brute de Django.
CSRF_FAILURE_VIEW = 'compte.views.echec_csrf'

# Le compteur de tentatives utilise le cache. LocMem suffit pour un seul processus (développement) ;
# en production avec plusieurs processus, utilisez un cache partagé (Redis, base de données…).
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}

# --- Inscription, vérification de l'e-mail, mot de passe oublié ---
VERIFICATION_EMAIL_JOURS = env_int('VERIFICATION_EMAIL_JOURS', 3)               # durée de validité du lien de vérification
RENVOI_VERIFICATION_SECONDES = env_int('RENVOI_VERIFICATION_SECONDES', 60)      # délai minimum entre deux renvois
PASSWORD_RESET_TIMEOUT = env_int('MDP_LIEN_DUREE_HEURES', 24) * 3600            # durée de validité du lien « mot de passe oublié »
