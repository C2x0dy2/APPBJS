"""Fabriques de données pour les tests : chaque test crée ses propres données, rien n'est écrit dans l'application."""
import io
import os
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
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


def creer_utilisateur(email='membre@test.fr', mot_de_passe='motdepasse-test-123', nom_utilisateur=None, **extra):
    """Le nom d'utilisateur, s'il n'est pas donné, est la partie de l'e-mail avant l'arobase."""
    return get_user_model().objects.create_user(
        username=nom_utilisateur or email.split('@')[0], email=email, password=mot_de_passe, **extra)


def parametres(**champs):
    return ParametresSite.objects.update_or_create(pk=1, defaults=champs)[0]


def creer_image(nom='photo.jpg', largeur=1200, hauteur=800, format='JPEG', couleur=(120, 60, 200), orientation_exif=None, bruit=False):
    """Une vraie image générée avec Pillow, prête à être « téléversée » dans un test.
    `bruit=True` : pixels aléatoires (fichier lourd, pour tester la limite de poids)."""
    from PIL import Image
    if bruit:
        image = Image.frombytes('RGB', (largeur, hauteur), os.urandom(largeur * hauteur * 3))
    else:
        image = Image.new('RGB', (largeur, hauteur), couleur)
    options = {}
    if orientation_exif:
        exif = Image.Exif()
        exif[0x0112] = orientation_exif
        options['exif'] = exif
    tampon = io.BytesIO()
    image.save(tampon, format, **options)
    return SimpleUploadedFile(nom, tampon.getvalue(), content_type=f'image/{format.lower()}')
