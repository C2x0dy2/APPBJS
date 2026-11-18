"""
Gestion des événements par un organisateur : validation de la saisie et enregistrement.

La saisie a la même forme que le formulaire de l'application (src/types/even.ts : NewEvent + types de places) :
{"name", "location", "date", "startTime", "doorsOpenTime", "timezone", "currency", "cancellationDeadline", "status",
 "ticketTypes": [{"id"?, "name", "price", "quantity", "earlyPrice"?, "earlyPriceDeadline"?}]}.
Les erreurs ont les mêmes clés que celles du formulaire ("name", "tickets.0.price"…) : l'application les affiche sous
le bon champ. Les prix arrivent en unités de la monnaie (20 = 20 €) et sont enregistrés en centièmes.
"""
import re
from datetime import datetime, time
from zoneinfo import ZoneInfo

from django.db import transaction
from django.utils import timezone
from django.utils.translation import gettext as _

from .api_commun import ErreurApi, ErreurValidation
from .models import Evenement, LigneCommande, Tarif, TypePlace
from .serialisation import BROUILLON, EN_VENTE, centimes_depuis, libelle_lieu

STATUTS_SAISISSABLES = (BROUILLON, EN_VENTE)
CAPACITE_MAX = 1_000_000


def _texte(donnees, cle):
    valeur = donnees.get(cle)
    return valeur.strip() if isinstance(valeur, str) else ''


def _date(valeur):
    try:
        return datetime.strptime(valeur, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return None


def _heure(valeur):
    try:
        return datetime.strptime(valeur, '%H:%M').time()
    except (ValueError, TypeError):
        return None


def lire_saisie(donnees):
    """Valide la saisie. Renvoie (champs de l'événement, types de places) ou lève ErreurValidation (une erreur par champ)."""
    erreurs = {}

    titre = _texte(donnees, 'name')
    if not titre:
        erreurs['name'] = _("Donne un nom à l'événement.")
    elif len(titre) > 200:
        erreurs['name'] = _('200 caractères au maximum.')

    lieu = _texte(donnees, 'location')
    if not lieu:
        erreurs['location'] = _("Indique le lieu (ou « En ligne »).")
    elif len(lieu) > 200:
        erreurs['location'] = _('200 caractères au maximum.')
    en_ligne = lieu.casefold() == _('En ligne').casefold()

    fuseau = None
    nom_fuseau = _texte(donnees, 'timezone')
    try:
        fuseau = ZoneInfo(nom_fuseau)
    except Exception:   # noqa: BLE001 : fuseau inconnu, vide ou illisible
        erreurs['timezone'] = _("Ce fuseau horaire n'existe pas (exemple : Europe/Paris).")

    jour = _date(_texte(donnees, 'date'))
    if jour is None:
        erreurs['date'] = _('Date au format AAAA-MM-JJ (exemple : 2026-11-18).')
    heure = _heure(_texte(donnees, 'startTime'))
    if heure is None:
        erreurs['startTime'] = _('Heure au format HH:MM (exemple : 20:00).')

    portes_saisie = _texte(donnees, 'doorsOpenTime')
    portes = _heure(portes_saisie) if portes_saisie else None
    if portes_saisie and portes is None:
        erreurs['doorsOpenTime'] = _('Heure au format HH:MM (exemple : 19:00).')

    devise = _texte(donnees, 'currency').upper()
    if not re.fullmatch(r'[A-Z]{3}', devise):
        erreurs['currency'] = _('Code de monnaie à 3 lettres (exemple : EUR, XOF).')

    limite_saisie = _texte(donnees, 'cancellationDeadline')
    limite = _date(limite_saisie) if limite_saisie else None
    if limite_saisie and limite is None:
        erreurs['cancellationDeadline'] = _('Date au format AAAA-MM-JJ.')
    elif limite and jour and limite > jour:
        erreurs['cancellationDeadline'] = _("La limite d'annulation ne peut pas être après l'événement.")

    statut = _texte(donnees, 'status')
    if statut not in STATUTS_SAISISSABLES:
        erreurs['status'] = _('Statut possible : brouillon ou en vente.')

    types = _lire_types(donnees.get('ticketTypes'), devise, erreurs)
    if statut == EN_VENTE and not types and 'tickets' not in erreurs:
        erreurs['tickets'] = _("Ajoute au moins un type de place pour mettre l'événement en vente.")
    if erreurs:
        raise ErreurValidation(erreurs)

    champs = {
        'titre': titre,
        'est_en_ligne': en_ligne,
        'lieu_texte': '' if en_ligne else lieu,
        'debut': datetime.combine(jour, heure, tzinfo=fuseau),
        'fuseau_horaire': nom_fuseau,
        'ouverture_portes': portes,
        'devise': devise,
        # « jusqu'au 17 » veut dire jusqu'à la fin du 17, dans le fuseau de l'événement
        'date_limite_annulation': datetime.combine(limite, time(23, 59, 59), tzinfo=fuseau) if limite else None,
        'publie': statut == EN_VENTE,
    }
    return champs, types


def _lire_types(brut, devise, erreurs):
    if brut is None:
        brut = []
    if not isinstance(brut, list):
        erreurs['tickets'] = _('Liste de types de places attendue.')
        return []
    types = []
    for i, saisie in enumerate(brut):
        cle = f'tickets.{i}'
        if not isinstance(saisie, dict):
            erreurs[cle] = _('Type de place illisible.')
            continue
        nom = _texte(saisie, 'name')
        if not nom:
            erreurs[f'{cle}.name'] = _('Donne un nom à cette place (Fosse, Balcon, VIP…).')
        elif len(nom) > 80:
            erreurs[f'{cle}.name'] = _('80 caractères au maximum.')

        prix = _prix(saisie.get('price'), devise, f'{cle}.price', erreurs)
        capacite = saisie.get('quantity')
        if isinstance(capacite, bool) or not isinstance(capacite, int) or not 1 <= capacite <= CAPACITE_MAX:
            erreurs[f'{cle}.quantity'] = _('Nombre entier supérieur à 0.')
            capacite = None

        tarif = None
        prix_early_saisi, fin_saisie = saisie.get('earlyPrice'), _texte(saisie, 'earlyPriceDeadline')
        if prix_early_saisi not in (None, '') or fin_saisie:
            prix_early = _prix(prix_early_saisi, devise, f'{cle}.earlyPrice', erreurs) if prix_early_saisi not in (None, '') else None
            fin = _date(fin_saisie) if fin_saisie else None
            if prix_early_saisi in (None, ''):
                erreurs[f'{cle}.earlyPrice'] = _('Indique aussi le prix early.')
            if not fin_saisie or fin is None:
                erreurs[f'{cle}.earlyPriceDeadline'] = _('Date au format AAAA-MM-JJ.')
            if prix_early is not None and prix is not None and prix_early >= prix:
                erreurs[f'{cle}.earlyPrice'] = _('Le prix early doit être inférieur au prix normal.')
            if prix_early is not None and fin is not None and f'{cle}.earlyPrice' not in erreurs:
                tarif = (prix_early, fin)

        identifiant = saisie.get('id')
        pk = None
        if identifiant not in (None, ''):
            texte_id = str(identifiant)
            if texte_id.isascii() and texte_id.isdigit():
                pk = int(texte_id)
            else:
                erreurs[f'{cle}.id'] = _('Identifiant de place inconnu.')
        types.append({'id': pk, 'nom': nom, 'capacite': capacite, 'prix': prix, 'tarif_early': tarif})
    return types


def _prix(valeur, devise, cle, erreurs):
    if valeur is None or valeur == '' or isinstance(valeur, bool):
        erreurs[cle] = _('Indique un prix (0 pour une place gratuite).')
        return None
    try:
        return centimes_depuis(valeur, devise)
    except ValueError as e:
        erreurs[cle] = {'decimales': _("Trop de décimales pour cette monnaie."), 'negatif': _('Un prix ne peut pas être négatif.')}.get(
            str(e), _('Nombre attendu (exemple : 20 ou 15.50).'))
        return None


# ====================================================================================== enregistrement
def _appliquer_types(evenement, types):
    existants = {t.pk: t for t in evenement.types_place.select_for_update()}
    gardes = set()
    erreurs = {}
    for i, saisie in enumerate(types):
        cle = f'tickets.{i}'
        if saisie['id'] is not None:
            type_place = existants.get(saisie['id'])
            if type_place is None:
                erreurs[f'{cle}.id'] = _("Cette place n'appartient pas à cet événement.")
                continue
            if saisie['capacite'] < type_place.vendues + type_place.retenues:
                erreurs[f'{cle}.quantity'] = _('%(n)s places sont déjà vendues ou réservées : tu ne peux pas descendre en dessous.') % {
                    'n': type_place.vendues + type_place.retenues}
                continue
            type_place.nom, type_place.capacite, type_place.prix_base_centimes = saisie['nom'], saisie['capacite'], saisie['prix']
            type_place.save(update_fields=['nom', 'capacite', 'prix_base_centimes'])
            gardes.add(type_place.pk)
        else:
            type_place = TypePlace.objects.create(evenement=evenement, nom=saisie['nom'], capacite=saisie['capacite'], prix_base_centimes=saisie['prix'])
        type_place.tarifs.all().delete()   # un seul tarif early par type : on le remplace
        if saisie['tarif_early']:
            prix_early, fin = saisie['tarif_early']
            Tarif.objects.create(type_place=type_place, prix_centimes=prix_early,
                                 valide_jusqua=datetime.combine(fin, time(23, 59, 59), tzinfo=ZoneInfo(evenement.fuseau_horaire)))
    for pk, type_place in existants.items():
        if pk in gardes:
            continue
        if type_place.vendues or type_place.retenues or LigneCommande.objects.filter(type_place=type_place).exists():
            erreurs['tickets'] = _('Impossible de supprimer « %(nom)s » : des places ont déjà été réservées.') % {'nom': type_place.nom}
            continue
        type_place.delete()
    if erreurs:
        raise ErreurValidation(erreurs)


@transaction.atomic
def creer_evenement(organisation, champs, types):
    evenement = Evenement.objects.create(organisation=organisation, **champs)
    _appliquer_types(evenement, types)
    return evenement


@transaction.atomic
def modifier_evenement(evenement, champs, types, maintenant=None):
    maintenant = maintenant or timezone.now()
    if evenement.annule or evenement.debut <= maintenant:
        raise ErreurApi('not_editable', _('Un événement terminé ou annulé ne peut plus être modifié.'), 409)
    erreurs = {}
    if evenement.publie and not champs['publie']:
        erreurs['status'] = _("Un événement en vente ne peut pas redevenir brouillon : des places ont pu être réservées.")
    if champs['devise'] != evenement.devise and evenement.commandes.exists():
        erreurs['currency'] = _("La monnaie ne peut plus changer : des réservations existent déjà.")
    if erreurs:
        raise ErreurValidation(erreurs)

    # Si le lieu n'a pas changé, on garde le lieu choisi dans l'administration (avec son adresse) ; sinon texte libre.
    libelle_actuel = libelle_lieu(evenement)
    nouveau = _('En ligne') if champs['est_en_ligne'] else champs['lieu_texte']
    if nouveau.casefold() != libelle_actuel.casefold():
        evenement.lieu = None
    elif evenement.lieu_id and not champs['est_en_ligne']:
        champs = {**champs, 'lieu_texte': evenement.lieu_texte}
    for nom, valeur in champs.items():
        setattr(evenement, nom, valeur)
    evenement.save()
    _appliquer_types(evenement, types)
    return evenement


def supprimer_brouillon(evenement):
    """Seul un brouillon sans aucune réservation peut disparaître ; un événement publié s'annule (services.annuler_evenement)."""
    if evenement.publie or evenement.annule or evenement.commandes.exists():
        raise ErreurApi('not_deletable', _('Seul un brouillon peut être supprimé. Un événement en vente s\'annule.'), 409)
    evenement.delete()
