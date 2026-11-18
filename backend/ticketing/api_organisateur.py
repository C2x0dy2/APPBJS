"""
API de l'organisateur : les événements de son collectif (créer, modifier, annuler, supprimer un brouillon), les chiffres
de vente, le scan des billets à l'entrée, l'export des participants et l'image principale.

Tout part de acces.py : un collectif ne voit jamais les données d'un autre, et la réponse est la même 404 dans tous les
cas d'échec (collectif ou événement inconnu, d'un autre collectif, rôle insuffisant).
"""
import csv

from django import forms
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.translation import gettext as _

from . import gestion, services, statistiques
from .acces import TOUS_LES_ROLES, collectif_courant, evenement_gere, evenements_de
from .api_commun import ErreurApi, ErreurValidation, api, lire_json
from .jetons import jeton_requis
from .models import Billet, Evenement, ParametresSite
from .serialisation import evenement_json, types_place_json


def _charger(pk):
    """L'événement avec tout ce qu'il faut pour être sérialisé sans requête supplémentaire par type de place."""
    return (Evenement.objects.filter(pk=pk).select_related('organisation', 'lieu').prefetch_related('types_place__tarifs').get())


def _reponse_evenement(pk, request, statut=200):
    return JsonResponse(evenement_json(_charger(pk), timezone.now(), ParametresSite.charger(), request), status=statut)


# ====================================================================================== événements
@api('GET', 'POST')
@jeton_requis
def evenements(request):
    """GET : tous les événements du collectif (brouillons et annulés compris). POST : en créer un.
    Le collectif est celui du paramètre/champ « collectiveId » (s'il en fait partie), sinon le premier de la personne."""
    if request.method == 'GET':
        maintenant, parametres = timezone.now(), ParametresSite.charger()
        collectif = collectif_courant(request.user, request.GET.get('collectiveId'))
        liste = (evenements_de(collectif).select_related('organisation', 'lieu').prefetch_related('types_place__tarifs').order_by('debut', 'pk'))
        return JsonResponse({'results': [evenement_json(e, maintenant, parametres, request) for e in liste]})

    donnees = lire_json(request)
    collectif = collectif_courant(request.user, donnees.get('collectiveId'))
    champs, types = gestion.lire_saisie(donnees)
    evenement = gestion.creer_evenement(collectif, champs, types)
    return _reponse_evenement(evenement.pk, request, statut=201)


@api('GET', 'PUT', 'DELETE')
@jeton_requis
def evenement(request, evenement_id):
    """GET : la fiche. PUT : la modifier (le collectif d'un événement ne change jamais). DELETE : supprimer un brouillon."""
    fiche = evenement_gere(request.user, evenement_id)
    if request.method == 'DELETE':
        gestion.supprimer_brouillon(fiche)
        return HttpResponse(status=204)
    if request.method == 'PUT':
        champs, types = gestion.lire_saisie(lire_json(request))
        gestion.modifier_evenement(fiche, champs, types)
    return _reponse_evenement(fiche.pk, request)


@api('GET')
@jeton_requis
def types_place(request, evenement_id):
    """Les types de place avec leurs ventes (`sold`, `held`) : réservé à l'organisateur."""
    fiche = evenement_gere(request.user, evenement_id)
    return JsonResponse({'results': types_place_json(_charger(fiche.pk), timezone.now(), ParametresSite.charger(), organisateur=True)})


@api('POST')
@jeton_requis
def annuler(request, evenement_id):
    """Annule un événement en vente (voir services.annuler_evenement). Rejouable sans effet."""
    fiche = evenement_gere(request.user, evenement_id)
    if not fiche.annule:
        if not fiche.publie:
            raise ErreurApi('not_cancellable', _("Un brouillon ne s'annule pas : supprime-le."), 409)
        if fiche.debut <= timezone.now():
            raise ErreurApi('not_cancellable', _('Un événement terminé ne peut plus être annulé.'), 409)
        services.annuler_evenement(fiche)
    return _reponse_evenement(fiche.pk, request)


# ====================================================================================== chiffres
@api('GET')
@jeton_requis
def stats_evenement(request, evenement_id):
    fiche = evenement_gere(request.user, evenement_id)
    return JsonResponse(statistiques.statistiques_evenement(_charger(fiche.pk), ParametresSite.charger(), request=request))


@api('GET')
@jeton_requis
def resume(request):
    """Argent encaissé et billets vendus du collectif, par monnaie."""
    collectif = collectif_courant(request.user, request.GET.get('collectiveId'))
    return JsonResponse({'results': statistiques.resume_collectif(collectif)})


# ====================================================================================== entrée
@api('POST')
@jeton_requis
def valider_entree(request, evenement_id):
    """Côté serveur du scanner : valide un billet de CET événement, de façon atomique. Tous les rôles (même le contrôleur seul)."""
    fiche = evenement_gere(request.user, evenement_id, roles=TOUS_LES_ROLES)
    code = lire_json(request).get('code')
    code = code if isinstance(code, str) else ''
    billet = Billet.objects.filter(code=code, commande__evenement=fiche).select_related('type_place').first()
    if billet is None:
        # Même réponse pour un code inconnu, d'un autre événement ou d'un autre collectif : rien n'est révélé.
        return JsonResponse({'result': 'invalid'})
    return JsonResponse({'result': services.valider_entree(code, timezone.now()), 'ticketType': billet.type_place.nom})


def _cellule_sure(valeur):
    """Évite l'injection de formule quand le fichier est ouvert dans un tableur."""
    texte = str(valeur)
    return "'" + texte if texte[:1] in ('=', '+', '-', '@') else texte


@api('GET')
@jeton_requis
def export_participants(request, evenement_id):
    fiche = evenement_gere(request.user, evenement_id)
    reponse = HttpResponse(content_type='text/csv; charset=utf-8')
    reponse['Content-Disposition'] = f'attachment; filename="participants-{fiche.slug}.csv"'
    reponse.write('﻿')   # pour qu'Excel lise bien les accents
    ecrivain = csv.writer(reponse)
    ecrivain.writerow([_('E-mail'), _('Type de place'), _('N° de billet'), _('Statut'), _('Scanné')])
    for b in Billet.objects.filter(commande__evenement=fiche).select_related('commande', 'type_place').order_by('commande_id', 'numero'):
        ecrivain.writerow([_cellule_sure(b.commande.email), _cellule_sure(b.type_place.nom), b.numero, b.statut,
                           _('oui') if b.statut == Billet.UTILISE else _('non')])
    return reponse


# ====================================================================================== image principale
class _FormulaireImage(forms.ModelForm):
    """Validation de l'image (vraie image JPG/PNG/WebP, poids et dimensions) et du texte alternatif, comme dans l'administration."""

    class Meta:
        model = Evenement
        fields = ('image_principale', 'image_principale_alt')


@api('POST', 'DELETE')
@jeton_requis
def image_principale(request, evenement_id):
    """POST (formulaire multipart : image, image_principale_alt) : remplace l'image. DELETE : la supprime."""
    fiche = evenement_gere(request.user, evenement_id)
    if request.method == 'DELETE':
        fiche.image_principale = ''
        fiche.image_principale_alt = ''
        fiche.save()
        return HttpResponse(status=204)
    formulaire = _FormulaireImage(request.POST, request.FILES, instance=fiche)
    if not formulaire.is_valid():
        champs = {'image_principale': 'image', 'image_principale_alt': 'alt'}
        raise ErreurValidation({champs.get(nom, nom): ' '.join(erreurs) for nom, erreurs in formulaire.errors.items()})
    formulaire.save()
    return _reponse_evenement(fiche.pk, request)
