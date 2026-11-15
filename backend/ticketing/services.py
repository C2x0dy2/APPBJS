"""Logique métier critique.

Tout passe par des UPDATE conditionnels atomiques : jamais « lire puis écrire »,
ce qui est la cause des places vendues en trop.
"""
from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from .models import Billet, Commande, LigneCommande, NotificationPaiement, TypePlace


class PlusDePlaces(Exception):
    def __init__(self, type_place):
        self.type_place = type_place


def _retenir(type_place_id, quantite):
    """Retient `quantite` places si et seulement s'il en reste. Atomique au niveau de la base."""
    return TypePlace.objects.filter(pk=type_place_id).extra(
        where=['vendues + retenues + %s <= capacite'], params=[quantite]
    ).update(retenues=F('retenues') + quantite)


def _relacher(type_place_id, quantite):
    TypePlace.objects.filter(pk=type_place_id).update(retenues=F('retenues') - quantite)


def _vendre(type_place_id, quantite):
    TypePlace.objects.filter(pk=type_place_id).update(
        retenues=F('retenues') - quantite, vendues=F('vendues') + quantite)


@transaction.atomic
def reserver(evenement, email, lignes, moyen_paiement='carte', maintenant=None):
    """lignes : [(type_place_id, quantité)].

    Lève PlusDePlaces sans rien retenir si une catégorie manque de places.
    """
    maintenant = maintenant or timezone.now()
    voulu = Counter()
    for type_id, quantite in lignes:
        voulu[type_id] += quantite
    commande = Commande.objects.create(
        evenement=evenement, email=email, moyen_paiement=moyen_paiement,
        expire_le=maintenant + timedelta(minutes=settings.DUREES_RETENUE_MINUTES[moyen_paiement]),
    )
    total = 0
    for type_id in sorted(voulu):   # ordre fixe : évite les blocages entre commandes concurrentes
        quantite = voulu[type_id]
        type_place = TypePlace.objects.get(pk=type_id, evenement=evenement)
        if _retenir(type_id, quantite) != 1:
            raise PlusDePlaces(type_place)   # transaction annulée : les retenues précédentes disparaissent
        prix = type_place.prix_a(maintenant)
        LigneCommande.objects.create(commande=commande, type_place=type_place, quantite=quantite, prix_unitaire_centimes=prix)
        total += prix * quantite
    commande.total_centimes = total
    commande.save(update_fields=['total_centimes'])
    return commande


def liberer_retenues_expirees(maintenant=None):
    """Libère les commandes non payées échues. Idempotent ; à lancer par une tâche planifiée."""
    maintenant = maintenant or timezone.now()
    compteur = 0
    echues = list(Commande.objects.filter(statut=Commande.EN_ATTENTE, expire_le__lte=maintenant).values_list('pk', flat=True))
    for commande_id in echues:
        with transaction.atomic():
            # La transition de statut est conditionnelle : un seul appelant gagne.
            if Commande.objects.filter(pk=commande_id, statut=Commande.EN_ATTENTE).update(statut=Commande.EXPIREE):
                for ligne in LigneCommande.objects.filter(commande_id=commande_id):
                    _relacher(ligne.type_place_id, ligne.quantite)
                compteur += 1
    return compteur


def _emettre_billets(commande):
    numero = 0
    for ligne in commande.lignes.select_related('type_place'):
        for _ in range(ligne.quantite):
            numero += 1
            Billet.objects.create(commande=commande, type_place=ligne.type_place, numero=numero)


def confirmer_paiement(id_fournisseur, commande_id, montant_centimes, maintenant=None):
    """Traite une notification de paiement, rejouable sans effet.

    Retourne 'paid', 'duplicate' ou 'late' (paiement après expiration, plus de place → remboursement).
    """
    maintenant = maintenant or timezone.now()
    try:
        with transaction.atomic():
            NotificationPaiement.objects.create(
                id_fournisseur=id_fournisseur, commande_id=commande_id, montant_centimes=montant_centimes)
            commande = Commande.objects.select_for_update().get(pk=commande_id)
            if commande.statut == Commande.PAYEE:
                return 'duplicate'   # autre notification pour la même commande
            lignes = list(commande.lignes.all())
            if commande.statut != Commande.EN_ATTENTE:
                # Retenue déjà libérée : on ne reprend les places que s'il en reste.
                reprises = []
                for ligne in lignes:
                    if _retenir(ligne.type_place_id, ligne.quantite) == 1:
                        reprises.append(ligne)
                        continue
                    for reprise in reprises:
                        _relacher(reprise.type_place_id, reprise.quantite)
                    commande.a_rembourser = True
                    commande.save(update_fields=['a_rembourser'])
                    return 'late'
            for ligne in lignes:
                _vendre(ligne.type_place_id, ligne.quantite)
            commande.statut, commande.payee_le = Commande.PAYEE, maintenant
            commande.save(update_fields=['statut', 'payee_le'])
            _emettre_billets(commande)
            return 'paid'
    except IntegrityError:
        return 'duplicate'   # identifiant du prestataire déjà vu


def valider_entree(code, maintenant=None):
    """Valide un billet à l'entrée. Retourne 'ok', 'already_used' ou 'invalid'."""
    maintenant = maintenant or timezone.now()
    if Billet.objects.filter(code=code, statut=Billet.VALIDE).update(statut=Billet.UTILISE, utilise_le=maintenant):
        return 'ok'
    return 'already_used' if Billet.objects.filter(code=code, statut=Billet.UTILISE).exists() else 'invalid'
