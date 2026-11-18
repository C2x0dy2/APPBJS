"""Chiffres de vente d'un événement et d'un collectif (tableau de bord de l'organisateur). Lecture seule.

« Argent encaissé » = les commandes PAYÉES que le collectif garde, au prix figé à la réservation (jamais le prix actuel).
« À rembourser » = les commandes marquées a_rembourser (paiement reçu trop tard, ou événement annulé après le paiement) :
l'argent est à rendre, ce n'est donc PAS du chiffre d'affaires. Un événement annulé rapporte 0 et affiche tout en « à rembourser ».
"""
from collections import Counter
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db.models import Count, F, Sum
from django.utils import timezone

from .models import Billet, Commande, LigneCommande
from .serialisation import evenement_json, instant_utc, montant, type_place_json

JOURS_GRAPHIQUE = 14


def _lignes_encaissees(**filtres):
    """Les lignes des commandes payées dont l'argent est gardé (pas celles à rembourser)."""
    return LigneCommande.objects.filter(commande__statut=Commande.PAYEE, commande__a_rembourser=False, **filtres)


def _revenus_par_type(evenement):
    lignes = (_lignes_encaissees(commande__evenement=evenement)
              .values('type_place').annotate(total=Sum(F('quantite') * F('prix_unitaire_centimes'))))
    return {ligne['type_place']: ligne['total'] or 0 for ligne in lignes}


def _ventes_par_jour(evenement, maintenant):
    """Billets vendus par jour sur les 14 derniers jours (le plus ancien d'abord). Les jours se terminent aujourd'hui,
    ou le jour de l'événement s'il est déjà passé. Les jours sont ceux du fuseau de l'événement."""
    fuseau = ZoneInfo(evenement.fuseau_horaire)
    fin = min(maintenant, evenement.debut).astimezone(fuseau).date()
    jours = [fin - timedelta(days=JOURS_GRAPHIQUE - 1 - i) for i in range(JOURS_GRAPHIQUE)]
    depuis = min(maintenant, evenement.debut).astimezone(fuseau).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=JOURS_GRAPHIQUE - 1)
    compteur = Counter()
    lignes = LigneCommande.objects.filter(commande__evenement=evenement, commande__statut=Commande.PAYEE,
                                          commande__payee_le__gte=depuis).values_list('commande__payee_le', 'quantite')
    for payee_le, quantite in lignes:
        compteur[payee_le.astimezone(fuseau).date()] += quantite
    return [{'date': jour.isoformat(), 'tickets': compteur.get(jour, 0)} for jour in jours]


def statistiques_evenement(evenement, parametres, maintenant=None, request=None):
    """`evenement` doit venir de select_related('organisation', 'lieu') + prefetch_related('types_place__tarifs')."""
    maintenant = maintenant or timezone.now()
    fuseau = ZoneInfo(evenement.fuseau_horaire)
    revenus = _revenus_par_type(evenement)
    types = []
    for t in sorted(evenement.types_place.all(), key=lambda t: t.pk):
        types.append({
            'ticketType': type_place_json(t, maintenant, fuseau, parametres, organisateur=True),
            'sold': t.vendues, 'held': t.retenues, 'free': max(t.disponibles, 0),
            'revenue': montant(revenus.get(t.pk, 0)),
        })
    capacite = sum(t['ticketType']['quantity'] for t in types)
    vendues = sum(t['sold'] for t in types)
    a_rembourser = Commande.objects.filter(evenement=evenement, a_rembourser=True).aggregate(n=Count('pk'), somme=Sum('total_centimes'))
    return {
        'event': evenement_json(evenement, maintenant, parametres, request),
        'types': types,
        'totals': {
            'capacity': capacite, 'sold': vendues,
            'held': sum(t['held'] for t in types), 'free': sum(t['free'] for t in types),
            'fillRate': vendues / capacite if capacite else 0,
            'revenue': montant(sum(revenus.values())),
        },
        'refunds': {'count': a_rembourser['n'] or 0, 'amount': montant(a_rembourser['somme'] or 0)},
        'entriesScanned': Billet.objects.filter(commande__evenement=evenement, statut=Billet.UTILISE).count(),
        'daily': _ventes_par_jour(evenement, maintenant),
        'generatedAt': instant_utc(maintenant),
    }


def resume_collectif(organisation):
    """Argent encaissé, billets vendus et paiements à rembourser du collectif, PAR MONNAIE (on n'additionne jamais des euros
    et des francs CFA). Une monnaie apparaît dès qu'elle a des ventes OU des remboursements à faire."""
    par_monnaie = {}

    def ligne(devise):
        return par_monnaie.setdefault(devise, {'currency': devise, 'revenue': 0, 'sold': 0, 'refunds': {'count': 0, 'amount': 0}})

    gardees = (_lignes_encaissees(commande__evenement__organisation=organisation).values('commande__evenement__devise')
               .annotate(revenu=Sum(F('quantite') * F('prix_unitaire_centimes')), billets=Sum('quantite')))
    for donnees in gardees:
        fiche = ligne(donnees['commande__evenement__devise'])
        fiche['revenue'], fiche['sold'] = montant(donnees['revenu'] or 0), donnees['billets'] or 0

    dues = (Commande.objects.filter(evenement__organisation=organisation, a_rembourser=True).values('evenement__devise')
            .annotate(n=Count('pk'), somme=Sum('total_centimes')))
    for donnees in dues:
        ligne(donnees['evenement__devise'])['refunds'] = {'count': donnees['n'], 'amount': montant(donnees['somme'] or 0)}

    return [par_monnaie[devise] for devise in sorted(par_monnaie)]
