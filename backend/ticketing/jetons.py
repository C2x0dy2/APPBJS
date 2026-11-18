"""Jeton d'accès de l'application : création, lecture de l'en-tête « Authorization: Bearer … », décorateur de vue.

Le jeton est un secret aléatoire de 256 bits. On n'enregistre que son empreinte SHA-256 (voir JetonApi) : le jeton en
clair n'existe que dans la réponse de connexion, puis dans l'appareil de la personne.
"""
import hashlib
import secrets
from datetime import timedelta
from functools import wraps

from django.http import JsonResponse
from django.utils import timezone
from django.utils.translation import gettext as _

from .models import JetonApi

# La date de « dernière utilisation » est mise à jour au plus une fois par heure (pas une écriture à chaque requête).
INTERVALLE_MAJ = timedelta(hours=1)


def empreinte(jeton):
    return hashlib.sha256(jeton.encode()).hexdigest()


def creer_jeton(utilisateur, appareil=''):
    """Crée un jeton et le renvoie EN CLAIR (à montrer une seule fois). Seule son empreinte est enregistrée."""
    jeton = secrets.token_urlsafe(32)
    JetonApi.objects.create(utilisateur=utilisateur, empreinte=empreinte(jeton), appareil=appareil[:120])
    return jeton


def _jeton_en_clair(request):
    schema, _espace, valeur = request.headers.get('Authorization', '').partition(' ')
    valeur = valeur.strip()
    return valeur if schema.lower() == 'bearer' and valeur else None


def jeton_courant(request, maintenant=None):
    """Le JetonApi valide de la requête, ou None (absent, inconnu, expiré ou compte désactivé : même résultat)."""
    clair = _jeton_en_clair(request)
    if not clair:
        return None
    maintenant = maintenant or timezone.now()
    jeton = JetonApi.objects.select_related('utilisateur').filter(empreinte=empreinte(clair)).first()
    if jeton is None or jeton.expire_le <= maintenant or not jeton.utilisateur.is_active:
        return None
    if jeton.derniere_utilisation is None or maintenant - jeton.derniere_utilisation > INTERVALLE_MAJ:
        JetonApi.objects.filter(pk=jeton.pk).update(derniere_utilisation=maintenant)
    return jeton


def non_autorise():
    reponse = JsonResponse({'error': 'unauthorized', 'message': _('Connexion requise.')}, status=401)
    reponse['WWW-Authenticate'] = 'Bearer'
    return reponse


def jeton_requis(vue):
    """Réserve la vue aux personnes connectées. Place `request.user` et `request.jeton`."""
    @wraps(vue)
    def enveloppe(request, *args, **kwargs):
        jeton = jeton_courant(request)
        if jeton is None:
            return non_autorise()
        request.user, request.jeton = jeton.utilisateur, jeton
        return vue(request, *args, **kwargs)
    return enveloppe


def revoquer_jetons(utilisateur, sauf=None):
    """Déconnecte tous les appareils du compte (par exemple après un changement de mot de passe)."""
    jetons = JetonApi.objects.filter(utilisateur=utilisateur)
    if sauf is not None:
        jetons = jetons.exclude(pk=sauf.pk)
    jetons.delete()
