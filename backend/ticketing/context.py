"""Données communes à toutes les pages (réglages du site et navigation)."""
import os

from django.conf import settings
from django.utils import timezone

from .models import Categorie, Evenement, Lieu, ParametresSite


def _version_assets():
    """Date de la dernière modification des CSS/JS : change leur adresse pour forcer le rechargement."""
    fichiers = ['css/variables.css', 'css/home.css', 'css/effects.css', 'css/auth.css', 'js/effects.js', 'js/auth.js']
    try:
        return int(max(os.path.getmtime(settings.BASE_DIR / 'assets' / f) for f in fichiers))
    except OSError:
        return 0


def site(request):
    parametres = ParametresSite.charger()
    categories = list(Categorie.objects.filter(actif=True))
    a_venir = Evenement.objects.publies_a_venir(timezone.now())
    menu_a_la_une = list(a_venir.filter(a_la_une=True).select_related('lieu')[:parametres.nombre_evenements_a_la_une])
    villes = list(Lieu.objects.filter(evenements__in=a_venir).order_by('ville').values_list('ville', flat=True).distinct())
    return {
        'site': parametres,
        'categories': categories,
        'categories_barre': categories[:parametres.nombre_categories_barre],
        'menu_a_la_une': menu_a_la_une,
        'villes': villes,
        'version_assets': _version_assets(),
    }
