"""
Format JSON de l'API v1.

Les noms de champs sont ceux des types TypeScript de l'application (src/types/even.ts, ticket.ts, order.ts, user.ts). Un test
(tests_api_v1.ContratReactTests) compare ces fichiers TypeScript à la réponse réelle, champ par champ : si l'un des deux change
sans l'autre, il échoue. Un champ facultatif côté TypeScript (`earlyPrice?`) est ABSENT de la réponse quand il n'a pas de valeur.

  Événement (Event)                   Source dans Django
  ---------------------------------   --------------------------------------------------------------------------
  id, collectiveId                    clés primaires (en texte) de l'événement et de son organisation
  name                                titre
  location                            « Salle, Ville » ; « En ligne » pour un événement en ligne ; sinon le lieu saisi
  date, startTime                     début converti dans le fuseau de l'événement (AAAA-MM-JJ et HH:MM)
  doorsOpenTime                       ouverture_portes (HH:MM), ou null si l'organisateur ne l'a pas communiquée
  timezone, currency                  fuseau_horaire, devise
  cancellationDeadline                jour (dans le fuseau de l'événement) de la limite d'annulation
  status                              voir statut_evenement()
  slug, isOnline, collectiveName      identifiant d'adresse, « en ligne » ou non, nom du collectif
  startsAt, cancellationDeadlineAt    les mêmes instants que date/startTime et cancellationDeadline, exacts (UTC)
  fromPrice                           le prix « dès » : le plus bas des prix en vigueur (null sans type de place)
  image                               l'affiche (voir image_json), ou null

  Type de place (TicketType)
  ---------------------------------   --------------------------------------------------------------------------
  id, eventId, name                   clé primaire, événement, nom
  price                               prix normal en UNITÉS de la monnaie (20 = 20 €) ; la base stocke des centièmes
  quantity                            nombre de places mises en vente (la capacité saisie par l'organisateur)
  earlyPrice, earlyPriceDeadline      tarif « early » encore valable ; champs ABSENTS sinon (jamais null : l'application
                                      teste `earlyPrice !== undefined`)
  currentPrice, remaining, soldOut    prix facturé maintenant, places restantes (seulement sous le seuil), complet ou non

Confidentialité : l'API PUBLIQUE ne montre PAS les ventes (billets vendus, chiffre d'affaires : réservés à l'espace
organisateur, cloisonné par collectif) et ne donne le nombre exact de places restantes que sous le seuil « dernières
places » des paramètres du site. Sinon, quelqu'un qui interroge l'API toutes les minutes pourrait suivre le rythme de
vente de chaque collectif. Les réponses de l'espace organisateur ajoutent `sold` et `held` (CHAMPS_ORGANISATEUR_TYPE_PLACE).

Montants : la base stocke des centièmes de l'unité pour TOUTES les monnaies (5 000 XOF = 500 000 stockés). L'API les
rend en unités, comme le formulaire de l'application. La conversion vers l'unité minimale d'un prestataire de paiement
(0 décimale pour le XOF) se fera là où le prestataire sera branché, pas ici.
"""
from datetime import timezone as fuseau_utc
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.utils.translation import gettext as _

from . import images
from .acces import collectifs_geres
from .models import Billet, Membre

# Statuts d'un événement, tels que l'application les nomme (src/types/even.ts : EvenStatus).
BROUILLON, EN_VENTE, COMPLET, TERMINE, ANNULE = 'draft', 'on_sale', 'sold_out', 'finished', 'canceled'

CHAMPS_ORGANISATEUR_TYPE_PLACE = {'sold', 'held'}   # en plus des champs de TicketType : réservés à l'espace organisateur

STATUTS_BILLET = {Billet.VALIDE: 'valid', Billet.UTILISE: 'used', Billet.ANNULE: 'canceled'}
MOYENS_PAIEMENT = {'carte': 'card', 'virement': 'transfer'}   # noms du serveur -> noms de l'application
ROLES_COLLECTIF = {Membre.ADMIN: 'admin', Membre.GESTIONNAIRE: 'manager', Membre.CONTROLEUR: 'controller'}

# Monnaies sans centimes (ISO 4217, exposant 0) : on n'accepte pas « 5000,5 XOF ».
DEVISES_SANS_DECIMALES = frozenset({'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND',
                                    'VUV', 'XAF', 'XOF', 'XPF'})


def montant(centimes):
    """Centièmes → unités de la monnaie : 2000 → 20 ; 1550 → 15.5 ; 0 → 0."""
    return centimes // 100 if centimes % 100 == 0 else centimes / 100


def centimes_depuis(prix, devise):
    """Unités → centièmes (20 → 2000). Lève ValueError si le prix est négatif, illisible ou a trop de décimales pour la monnaie."""
    try:
        valeur = Decimal(str(prix).strip().replace(',', '.'))
    except (InvalidOperation, ValueError):
        raise ValueError('illisible')
    if not valeur.is_finite() or valeur < 0:
        raise ValueError('negatif')
    decimales = 0 if devise.upper() in DEVISES_SANS_DECIMALES else 2
    if valeur != valeur.quantize(Decimal(1).scaleb(-decimales)):
        raise ValueError('decimales')
    return int(valeur * 100)


def instant_utc(instant):
    """Instant précis, en UTC : « 2026-11-18T19:00:00Z ». Sans ambiguïté, quel que soit le fuseau de celui qui lit."""
    return instant.astimezone(fuseau_utc.utc).isoformat().replace('+00:00', 'Z')


def jour_local(instant, fuseau):
    """Le jour (AAAA-MM-JJ) où tombe cet instant dans le fuseau donné."""
    return instant.astimezone(fuseau).date().isoformat()


def libelle_lieu(evenement):
    if evenement.est_en_ligne:
        return _('En ligne')
    if evenement.lieu:
        return f'{evenement.lieu.nom}, {evenement.lieu.ville}'
    return evenement.lieu_texte   # le lieu saisi à la main (vide si rien n'est renseigné : on n'invente rien)


def statut_evenement(evenement, types_place, maintenant):
    """Annulé > brouillon (non publié) > terminé (début passé) > complet (aucune place nulle part) > en vente.
    Un événement sans type de place n'est pas « complet » : il n'y a simplement rien à acheter."""
    if evenement.annule:
        return ANNULE
    if not evenement.publie:
        return BROUILLON
    if evenement.debut <= maintenant:
        return TERMINE
    if types_place and all(t.disponibles <= 0 for t in types_place):
        return COMPLET
    return EN_VENTE


def _url_absolue(url, request):
    return request.build_absolute_uri(url) if request is not None and url.startswith('/') else url


def image_json(evenement, request=None):
    """L'image principale : adresse de la version moyenne, texte alternatif, dimensions, et toutes les versions WebP
    (pour que l'application choisisse la bonne selon l'écran). None s'il n'y a pas d'image."""
    fichier = evenement.image_principale
    if not fichier:
        return None
    largeur = evenement.image_principale_largeur
    sources = [{'width': w, 'url': _url_absolue(fichier.storage.url(nom), request)} for w, nom in images.versions(fichier.name, largeur)] if largeur else []
    return {
        'url': _url_absolue(images.url_version(fichier, 'moyenne'), request),
        'alt': evenement.image_principale_alt,
        'width': largeur, 'height': evenement.image_principale_hauteur,
        'sources': sources,
    }


def evenement_json(evenement, maintenant, parametres, request=None):
    """`evenement` doit venir de select_related('organisation', 'lieu') + prefetch_related('types_place__tarifs') (sinon une
    requête par événement ou par type de place). `parametres` : la fiche ParametresSite, lue une seule fois par l'appelant."""
    fuseau = ZoneInfo(evenement.fuseau_horaire)
    debut = evenement.debut.astimezone(fuseau)
    limite = evenement.calculer_limite_annulation(parametres)
    portes = evenement.ouverture_portes
    types = list(evenement.types_place.all())
    prix = [t.prix_a(maintenant, list(t.tarifs.all())) for t in types]
    return {
        'id': str(evenement.pk),
        'collectiveId': str(evenement.organisation_id),
        'name': evenement.titre,
        'location': libelle_lieu(evenement),
        'date': debut.date().isoformat(),
        'startTime': debut.strftime('%H:%M'),
        'doorsOpenTime': portes.strftime('%H:%M') if portes else None,
        'timezone': evenement.fuseau_horaire,
        'currency': evenement.devise,
        'cancellationDeadline': jour_local(limite, fuseau),
        'status': statut_evenement(evenement, types, maintenant),
        # --- en plus des types de l'application ---
        'slug': evenement.slug,
        'isOnline': evenement.est_en_ligne,
        'collectiveName': evenement.organisation.nom,
        'startsAt': instant_utc(evenement.debut),
        'cancellationDeadlineAt': instant_utc(limite),
        'fromPrice': montant(min(prix)) if prix else None,   # le prix « dès » : le plus bas des prix en vigueur
        'image': image_json(evenement, request),
    }


def places_restantes_visibles(type_place, parametres):
    """Nombre exact de places restantes, seulement quand il en reste peu : mêmes règles que le badge « Plus que N places »
    (moins de « seuil % » de la capacité, et au moins une place). Sinon None : l'acheteur ne voit que `soldOut`."""
    restantes = type_place.disponibles
    if 0 < restantes and restantes * 100 < parametres.seuil_dernieres_places_pct * type_place.capacite:
        return restantes
    return None


def type_place_json(type_place, maintenant, fuseau, parametres, organisateur=False):
    """`type_place` doit venir de prefetch_related('types_place__tarifs'). `organisateur=True` ajoute les ventes
    (réservé aux réponses de l'espace organisateur)."""
    tarif = type_place.tarif_en_vigueur(maintenant, list(type_place.tarifs.all()))
    prix_courant = tarif.prix_centimes if tarif else type_place.prix_base_centimes
    donnees = {
        'id': str(type_place.pk),
        'eventId': str(type_place.evenement_id),
        'name': type_place.nom,
        'price': montant(type_place.prix_base_centimes),
        'quantity': type_place.capacite,
        # --- en plus des types de l'application ---
        'currentPrice': montant(prix_courant),   # le prix qui sera réellement facturé maintenant (l'horloge du serveur fait foi)
        'remaining': places_restantes_visibles(type_place, parametres),   # null tant qu'il reste beaucoup de places
        'soldOut': type_place.disponibles <= 0,
    }
    if tarif:   # champs optionnels : absents (et non null) quand il n'y a pas de tarif early en cours
        donnees['earlyPrice'] = montant(tarif.prix_centimes)
        donnees['earlyPriceDeadline'] = jour_local(tarif.valide_jusqua, fuseau)
    if organisateur:
        donnees['sold'] = type_place.vendues
        donnees['held'] = type_place.retenues
    return donnees


def types_place_json(evenement, maintenant, parametres, organisateur=False):
    """Les types de place d'un événement, dans l'ordre où l'organisateur les a créés."""
    fuseau = ZoneInfo(evenement.fuseau_horaire)
    return [type_place_json(t, maintenant, fuseau, parametres, organisateur)
            for t in sorted(evenement.types_place.all(), key=lambda t: t.pk)]


def utilisateur_json(utilisateur):
    """La personne connectée. `role` vaut « organizer » si elle gère au moins un collectif, « buyer » sinon."""
    collectifs = list(collectifs_geres(utilisateur))
    roles = dict(Membre.objects.filter(utilisateur=utilisateur, organisation__in=collectifs).values_list('organisation_id', 'role'))
    donnees = {
        'id': str(utilisateur.pk),
        'name': utilisateur.first_name or utilisateur.username,
        'username': utilisateur.username,
        'email': utilisateur.email,
        'role': 'organizer' if collectifs else 'buyer',
        'emailVerified': utilisateur.email_verifie,
        'collectives': [{'id': str(c.pk), 'name': c.nom, 'role': ROLES_COLLECTIF.get(roles.get(c.pk))} for c in collectifs],
    }
    if collectifs:   # facultatif côté application : absent pour un acheteur
        donnees['collectiveId'] = str(collectifs[0].pk)
    return donnees


def billet_json(billet):
    donnees = {
        'id': str(billet.pk),
        'eventId': str(billet.commande.evenement_id),
        'ticketTypeId': str(billet.type_place_id),
        'orderId': str(billet.commande_id),
        'code': billet.code,   # le contenu du QR code : visible de son propriétaire seulement
        'status': STATUTS_BILLET[billet.statut],
    }
    if billet.utilise_le:
        donnees['usedAt'] = instant_utc(billet.utilise_le)
    return donnees


def billet_complet_json(billet, maintenant, parametres, request=None):
    """Un billet avec tout ce qu'il faut pour l'afficher : {ticket, event, ticketType}."""
    evenement = billet.commande.evenement
    fuseau = ZoneInfo(evenement.fuseau_horaire)
    return {
        'ticket': billet_json(billet),
        'event': evenement_json(evenement, maintenant, parametres, request),
        'ticketType': type_place_json(billet.type_place, maintenant, fuseau, parametres),
    }


def commande_json(commande, maintenant, parametres, request=None):
    """Une réservation : {order, event, lines, total}. `commande` doit venir de select_related('evenement__organisation')
    + prefetch_related('lignes__type_place__tarifs', 'evenement__types_place__tarifs')."""
    evenement = commande.evenement
    fuseau = ZoneInfo(evenement.fuseau_horaire)
    lignes = list(commande.lignes.all())
    return {
        'order': {
            'id': str(commande.pk),
            'eventId': str(commande.evenement_id),
            'expiresAt': instant_utc(commande.expire_le),
            'paymentMethod': MOYENS_PAIEMENT.get(commande.moyen_paiement, commande.moyen_paiement),
            'lines': [{'ticketTypeId': str(l.type_place_id), 'quantity': l.quantite} for l in lignes],
        },
        'event': evenement_json(evenement, maintenant, parametres, request),
        'lines': [{'ticketType': type_place_json(l.type_place, maintenant, fuseau, parametres), 'quantity': l.quantite,
                   'unitPrice': montant(l.prix_unitaire_centimes)} for l in lignes],
        'total': montant(commande.total_centimes),
    }
