"""API de l'acheteur (connecté) : ses billets, ses réservations en cours, réserver des places.

Un billet est visible de son propriétaire seulement : celui dont le compte a passé la commande, ou celui dont l'adresse
e-mail VÉRIFIÉE est celle de la commande (commande passée avant la création du compte). Une adresse non vérifiée ne
donne accès à rien : sinon quelqu'un pourrait ouvrir un compte avec l'adresse d'un autre pour lire ses billets.
"""
from django.conf import settings
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.translation import gettext as _

from . import services
from .api_commun import ErreurApi, ErreurValidation, NonTrouve, api, identifiant_entier, lire_json
from .api_v1 import evenement_public
from .jetons import jeton_requis
from .models import Billet, Commande, ParametresSite
from .serialisation import billet_complet_json, commande_json

MOYENS = {'card': 'carte', 'transfer': 'virement'}   # noms de l'application -> noms du serveur


def commandes_en_attente(utilisateur, maintenant):
    """Les réservations non payées de cette personne dont les places sont encore bloquées, la plus pressée d'abord.
    Chargées avec tout ce qu'il faut pour être sérialisées (pas de requête par réservation)."""
    return (Commande.objects.filter(utilisateur=utilisateur, statut=Commande.EN_ATTENTE, expire_le__gt=maintenant)
            .select_related('evenement__organisation', 'evenement__lieu')
            .prefetch_related('lignes__type_place__tarifs', 'evenement__types_place__tarifs')
            .order_by('expire_le', 'pk'))


def _billets_de(utilisateur):
    propres = Q(commande__utilisateur=utilisateur)
    if utilisateur.email_verifie:
        propres |= Q(commande__email__iexact=utilisateur.email)
    return (Billet.objects.filter(propres)
            .select_related('commande__evenement__organisation', 'commande__evenement__lieu', 'type_place')
            .prefetch_related('commande__evenement__types_place__tarifs', 'type_place__tarifs')
            .order_by('commande__evenement__debut', 'commande_id', 'numero'))


@api('GET')
@jeton_requis
def mes_billets(request):
    maintenant, parametres = timezone.now(), ParametresSite.charger()
    return JsonResponse({'results': [billet_complet_json(b, maintenant, parametres, request) for b in _billets_de(request.user)]})


@api('GET')
@jeton_requis
def mon_billet(request, billet_id):
    pk = identifiant_entier(billet_id)
    billet = _billets_de(request.user).filter(pk=pk).first() if pk is not None else None
    if billet is None:
        raise NonTrouve(_('Billet introuvable'))   # même réponse pour un billet inconnu et pour celui d'un autre compte
    return JsonResponse(billet_complet_json(billet, timezone.now(), ParametresSite.charger(), request))


@api('GET')
@jeton_requis
def mes_reservations(request):
    """Les réservations pas encore payées, dont les places sont encore bloquées."""
    maintenant = timezone.now()
    services.liberer_retenues_expirees(maintenant)
    parametres = ParametresSite.charger()
    return JsonResponse({'results': [commande_json(c, maintenant, parametres, request) for c in commandes_en_attente(request.user, maintenant)]})


@api('POST')
@jeton_requis
def reserver(request, evenement_id):
    """Réserve des places : elles sont bloquées le temps du délai de paiement (15 minutes par carte), puis rendues si rien n'est payé.
    Corps : {"items": [{"ticketTypeId": "5", "quantity": 2}], "paymentMethod": "card"}."""
    utilisateur = request.user
    if not utilisateur.email_verifie:
        raise ErreurApi('email_not_verified', _('Vérifie ton adresse e-mail avant de réserver.'), 403)
    maintenant = timezone.now()
    services.liberer_retenues_expirees(maintenant)
    evenement = evenement_public(evenement_id)
    if evenement.debut <= maintenant:
        raise ErreurApi('event_over', _('Cet événement est déjà commencé ou terminé.'), 409)

    donnees = lire_json(request)
    moyen = MOYENS.get(donnees.get('paymentMethod', 'card'))
    if moyen is None or moyen not in settings.DUREES_RETENUE_MINUTES:
        raise ErreurValidation({'paymentMethod': _('Moyen de paiement inconnu.')})
    items = donnees.get('items')
    if not isinstance(items, list) or not items:
        raise ErreurValidation({'items': _('Choisis au moins une place.')})
    lignes, ids_du_type = [], {str(t.pk): t.pk for t in evenement.types_place.all()}
    for item in items:
        quantite = item.get('quantity') if isinstance(item, dict) else None
        type_id = ids_du_type.get(str(item.get('ticketTypeId'))) if isinstance(item, dict) else None
        if type_id is None:
            raise ErreurValidation({'items': _("Cette place n'existe pas pour cet événement.")})
        if isinstance(quantite, bool) or not isinstance(quantite, int) or quantite < 1:
            raise ErreurValidation({'items': _('Quantité : un nombre entier supérieur à 0.')})
        lignes.append((type_id, quantite))
    maximum = settings.MAX_PLACES_PAR_COMMANDE
    if sum(q for _t, q in lignes) > maximum:
        raise ErreurValidation({'items': _('Tu peux réserver %(max)s places au maximum à la fois.') % {'max': maximum}})

    # Anti-accaparement : quelques réservations non payées à la fois, pas de quoi bloquer toutes les places.
    if Commande.objects.filter(utilisateur=utilisateur, statut=Commande.EN_ATTENTE, expire_le__gt=maintenant).count() >= settings.COMMANDES_EN_ATTENTE_MAX:
        raise ErreurApi('too_many_pending', _("Tu as déjà plusieurs réservations en attente de paiement. Paie-les ou laisse-les expirer."), 409)

    try:
        commande = services.reserver(evenement, utilisateur.email, lignes, moyen, maintenant, utilisateur)
    except services.PlusDePlaces as e:
        raise ErreurApi('sold_out', _('Plus assez de places pour « %(nom)s ».') % {'nom': e.type_place.nom}, 409, ticketTypeId=str(e.type_place.pk))
    commande = commandes_en_attente(utilisateur, maintenant).get(pk=commande.pk)
    return JsonResponse(commande_json(commande, maintenant, ParametresSite.charger(), request), status=201)
