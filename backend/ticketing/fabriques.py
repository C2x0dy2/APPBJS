"""Fabriques de données pour les tests : chaque test crée ses propres données, rien n'est écrit dans l'application."""
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import Evenement, Organisation, ParametresSite, TypePlace


def creer_organisation(nom='Collectif A'):
    """Crée l'organisation, ou la retrouve si elle existe déjà (plusieurs événements pour un même collectif)."""
    return Organisation.objects.get_or_create(slug=nom.lower().replace(' ', '-'), defaults={'nom': nom})[0]


def creer_evenement(organisation=None, titre='Événement test', jours=30, capacite=10, prix=2000, publie=True,
                    nom_place='Standard', **extra):
    organisation = organisation or creer_organisation()
    evenement = Evenement.objects.create(
        organisation=organisation, titre=titre, debut=timezone.now() + timedelta(days=jours), publie=publie, **extra)
    type_place = TypePlace.objects.create(evenement=evenement, nom=nom_place, capacite=capacite, prix_base_centimes=prix)
    return evenement, type_place


def creer_utilisateur(email='membre@test.fr', mot_de_passe='motdepasse-test-123', **extra):
    return get_user_model().objects.create_user(email=email, password=mot_de_passe, **extra)


def parametres(**champs):
    return ParametresSite.objects.update_or_create(pk=1, defaults=champs)[0]
