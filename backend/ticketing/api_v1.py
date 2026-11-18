"""API v1 publique : événements publiés, réglages du site, pages légales.

Le format de chaque réponse est décrit dans serialisation.py. Ces routes ne demandent aucune connexion : elles
n'exposent que ce que le site public montrait déjà (événements publiés et non annulés). Les routes de l'acheteur
(api_acheteur.py) et de l'organisateur (api_organisateur.py) sont protégées par jeton ; celles de l'organisateur sont
en plus cloisonnées par collectif (acces.py).
"""
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.utils.translation import gettext as _

from . import services
from .api_commun import NonTrouve, api, erreur, identifiant_entier
from .models import Evenement, PageLegale, ParametresSite
from .serialisation import evenement_json, instant_utc, types_place_json


def evenement_public(evenement_id):
    """L'événement publié (et non annulé) portant cet identifiant. Un brouillon, un événement annulé et un identifiant qui
    n'existe pas sont indiscernables : on ne révèle pas l'existence d'un événement non public."""
    pk = identifiant_entier(evenement_id)
    evenement = None
    if pk is not None:
        evenement = (Evenement.objects.publics().filter(pk=pk).select_related('organisation', 'lieu')
                     .prefetch_related('types_place__tarifs').first())
    if evenement is None:
        raise NonTrouve(_('Événement introuvable'))
    return evenement


@api('GET')
def liste_evenements(request):
    """Événements publiés dont le début n'est pas passé, du plus proche au plus lointain (ce que `getPublicEvents` attend)."""
    maintenant = timezone.now()
    services.liberer_retenues_expirees(maintenant)   # les places bloquées par une réservation expirée redeviennent visibles
    parametres = ParametresSite.charger()   # une seule lecture pour toute la liste
    evenements = (Evenement.objects.publies_a_venir(maintenant).select_related('organisation', 'lieu')
                  .prefetch_related('types_place__tarifs'))
    return JsonResponse({'results': [evenement_json(e, maintenant, parametres, request) for e in evenements]})


@api('GET')
def detail_evenement(request, evenement_id):
    """Un événement publié (même passé : un billet déjà acheté renvoie vers sa fiche), ce que `getEventById` attend."""
    maintenant = timezone.now()
    services.liberer_retenues_expirees(maintenant)
    evenement = evenement_public(evenement_id)
    return JsonResponse(evenement_json(evenement, maintenant, ParametresSite.charger(), request))


@api('GET')
def types_place_evenement(request, evenement_id):
    """Les types de place d'un événement publié, ce que `getTicketTypes` attend."""
    maintenant = timezone.now()
    services.liberer_retenues_expirees(maintenant)
    evenement = evenement_public(evenement_id)
    return JsonResponse({'results': types_place_json(evenement, maintenant, ParametresSite.charger())})


@api('GET')
def reglages_site(request):
    """Ce que l'application a besoin de savoir du site : contact et pages légales à proposer à l'inscription, et les
    règles de réservation. Un texte non renseigné dans l'administration vaut null (l'application n'affiche alors rien).
    Les règles (`maxTicketsPerOrder`, `defaultCurrency`, `defaultTimezone`) viennent de la configuration du serveur :
    l'application ne les recopie pas, elle les lit ici."""
    parametres = ParametresSite.charger()

    def page(fiche):
        return {'slug': fiche.slug, 'title': fiche.titre} if fiche is not None and fiche.publiee else None

    return JsonResponse({
        'name': parametres.nom_site or None,
        'contactEmail': parametres.email_contact or None,
        'contactPhone': parametres.telephone_contact or None,
        'termsPage': page(parametres.page_cgv),
        'privacyPage': page(parametres.page_confidentialite),
        'maxTicketsPerOrder': settings.MAX_PLACES_PAR_COMMANDE,
        'defaultCurrency': settings.DEVISE_PAR_DEFAUT,
        'defaultTimezone': settings.TIME_ZONE,
    })


@api('GET')
def page_legale(request, slug):
    """Une page de texte rédigée dans l'administration (CGV, confidentialité, mentions légales…)."""
    fiche = PageLegale.objects.filter(slug=slug, publiee=True).first()
    if fiche is None:
        raise NonTrouve(_('Page introuvable'))
    return JsonResponse({'slug': fiche.slug, 'title': fiche.titre, 'content': fiche.contenu, 'updatedAt': instant_utc(fiche.modifiee_le)})


@api('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
def route_inconnue(request, chemin):
    """Toute autre adresse sous /api/v1/ : une réponse JSON (et non la page HTML d'erreur de Django)."""
    if chemin and not chemin.endswith('/'):
        return erreur('not_found', _("Adresse inconnue : les adresses de l'API se terminent par « / »."), 404)
    return erreur('not_found', _('Adresse inconnue'), 404)
