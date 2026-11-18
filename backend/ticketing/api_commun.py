"""Briques communes de l'API de l'application (/api/v1/) : réponses d'erreur, lecture du JSON, décorateur de vue.

Toute erreur a la même forme : {"error": "<code lisible par le programme>", "message": "<texte pour l'humain>"}, plus
éventuellement "fields" (une erreur par champ de formulaire) ou d'autres précisions utiles au programme.
"""
import json
from functools import wraps

from django.http import JsonResponse
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

# La protection CSRF défend les formulaires qui s'appuient sur le cookie de session du navigateur. Cette API n'en utilise
# jamais : l'application s'identifie par un jeton envoyé dans l'en-tête Authorization, qu'aucun site tiers ne peut faire
# envoyer à sa place. Toutes les vues de l'API sont donc `csrf_exempt` (voir le décorateur `api` ci-dessous) : sans cela,
# un POST recevrait la page HTML d'erreur CSRF au lieu d'une réponse JSON.


class ErreurApi(Exception):
    """Une erreur à renvoyer telle quelle à l'application."""

    def __init__(self, code, message, statut=400, **precisions):
        super().__init__(message)
        self.code, self.message, self.statut, self.precisions = code, message, statut, precisions


class NonTrouve(ErreurApi):
    """404. Même réponse pour « n'existe pas » et « existe mais n'est pas à vous » : on ne révèle rien."""

    def __init__(self, message=None):
        super().__init__('not_found', message or _('Introuvable'), 404)


class ErreurValidation(ErreurApi):
    """400 avec une erreur par champ : {"fields": {"name": "...", "tickets.0.price": "..."}}."""

    def __init__(self, champs, message=None):
        super().__init__('validation', message or _('Certains champs sont à corriger.'), 400, fields=champs)


def erreur(code, message, statut, **precisions):
    return JsonResponse({'error': code, 'message': message, **precisions}, status=statut)


def api(*methodes):
    """Décorateur des vues de l'API : refuse les autres méthodes HTTP (405), désactive CSRF, et transforme
    une ErreurApi levée dans la vue en réponse JSON."""
    def decorateur(vue):
        @csrf_exempt
        @require_http_methods(methodes)
        @wraps(vue)
        def enveloppe(request, *args, **kwargs):
            try:
                return vue(request, *args, **kwargs)
            except ErreurApi as e:
                return erreur(e.code, e.message, e.statut, **e.precisions)
        return enveloppe
    return decorateur


def lire_json(request):
    """Le corps de la requête, qui doit être un objet JSON."""
    try:
        donnees = json.loads(request.body or b'{}')
    except ValueError:
        donnees = None
    if not isinstance(donnees, dict):
        raise ErreurApi('invalid_json', _('Le corps de la requête doit être un objet JSON.'))
    return donnees


def identifiant_entier(valeur):
    """'12' -> 12 ; tout ce qui n'est pas une suite de chiffres ASCII -> None (jamais d'exception)."""
    texte = str(valeur)
    if not (texte.isascii() and texte.isdigit()):
        return None
    try:
        return int(texte)
    except ValueError:
        return None
