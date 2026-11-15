"""
Images : validation à l'upload, versions WebP automatiques, suppression des fichiers.

Principe
- À l'upload, une image est vérifiée : format réel (JPG, PNG ou WebP, d'après le CONTENU du fichier et non
  l'extension), poids, dimensions minimales. Les limites sont dans settings.py (modifiables dans .env).
- Après l'enregistrement, des versions WebP (miniature, moyenne, grande) sont créées à côté de l'original :
  `photo.jpg` donne `photo-320w.webp`, `photo-800w.webp`, `photo-1600w.webp`. Une version n'est jamais plus
  large que l'original (on n'agrandit pas) ; les métadonnées (position GPS…) ne sont pas recopiées.
- Quand une image est remplacée ou supprimée, l'original ET ses versions sont supprimés.

Tout passe par l'API de stockage de Django (storage.open / save / delete) : le code marche aussi bien avec
des fichiers locaux qu'avec un stockage externe configuré en production (voir MEDIA_STORAGE_BACKEND).
"""
import io
import logging
import os
import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.utils.translation import gettext as _
from PIL import Image, ImageOps, UnidentifiedImageError

journal = logging.getLogger(__name__)


# ====================================================================================== validation
def valider_image(fichier):
    """Validateur de champ : refuse tout ce qui n'est pas une vraie image JPG/PNG/WebP, trop lourde ou trop petite.
    Ne vérifie que les NOUVEAUX fichiers : une image déjà enregistrée n'est pas re-contrôlée à chaque modification."""
    if getattr(fichier, '_committed', False):
        return
    maximum = settings.IMAGE_TAILLE_MAX_MO * 1024 * 1024
    if fichier.size > maximum:
        raise ValidationError(
            _('Cette image est trop lourde (%(taille).1f Mo). Maximum : %(max)s Mo.'),
            params={'taille': fichier.size / 1024 / 1024, 'max': settings.IMAGE_TAILLE_MAX_MO}, code='trop_lourde')
    try:
        fichier.seek(0)
        with Image.open(fichier) as image:
            if image.format not in settings.IMAGE_FORMATS_AUTORISES:
                raise ValidationError(_('Format non accepté : utilisez une image JPG, PNG ou WebP.'), code='format')
            if getattr(image, 'is_animated', False):
                raise ValidationError(_('Les images animées ne sont pas acceptées.'), code='animee')
            largeur, hauteur = image.size
            if largeur * hauteur > settings.IMAGE_PIXELS_MAX:
                raise ValidationError(_("Cette image est trop grande (%(l)s × %(h)s pixels). Réduisez-la avant de l'envoyer."),
                                      params={'l': largeur, 'h': hauteur}, code='trop_grande')
            if largeur < settings.IMAGE_LARGEUR_MIN or hauteur < settings.IMAGE_HAUTEUR_MIN:
                raise ValidationError(
                    _("Cette image est trop petite (%(l)s × %(h)s pixels). Minimum : %(lmin)s × %(hmin)s pixels."),
                    params={'l': largeur, 'h': hauteur, 'lmin': settings.IMAGE_LARGEUR_MIN, 'hmin': settings.IMAGE_HAUTEUR_MIN},
                    code='trop_petite')
            image.verify()   # détecte un fichier tronqué ou corrompu
    except ValidationError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise ValidationError(_("Ce fichier n'est pas une image lisible (JPG, PNG ou WebP)."), code='illisible')
    finally:
        fichier.seek(0)


# ====================================================================================== versions WebP
def _racine(nom):
    return os.path.splitext(nom)[0]


def largeurs_pour(largeur_originale):
    """Largeurs des versions à produire pour une image de cette largeur : jamais plus large que l'original."""
    return sorted({min(cible, largeur_originale) for cible in settings.IMAGE_LARGEURS.values()})


def nom_version(nom, largeur):
    return f'{_racine(nom)}-{largeur}w.webp'


def versions(nom, largeur_originale):
    """[(largeur, nom de fichier)] des versions WebP d'une image, de la plus petite à la plus grande."""
    return [(largeur, nom_version(nom, largeur)) for largeur in largeurs_pour(largeur_originale)]


def generer_versions(stockage, nom):
    """Crée les versions WebP d'une image déjà enregistrée. Corrige l'orientation EXIF puis perd les métadonnées.
    Renvoie (largeur, hauteur) de l'image redressée : ce sont CES dimensions qu'on enregistre en base."""
    with stockage.open(nom, 'rb') as fichier:
        image = Image.open(fichier)
        image.load()
    image = ImageOps.exif_transpose(image)
    transparence = image.mode in ('RGBA', 'LA', 'P') and ('transparency' in image.info or image.mode in ('RGBA', 'LA'))
    image = image.convert('RGBA' if transparence else 'RGB')
    dimensions = (image.width, image.height)
    for largeur in largeurs_pour(image.width):
        hauteur = max(1, round(image.height * largeur / image.width))
        reduite = image if largeur == image.width else image.resize((largeur, hauteur), Image.LANCZOS)
        tampon = io.BytesIO()
        reduite.save(tampon, 'WEBP', quality=settings.IMAGE_QUALITE_WEBP, method=4)
        chemin = nom_version(nom, largeur)
        if stockage.exists(chemin):
            stockage.delete(chemin)
        stockage.save(chemin, ContentFile(tampon.getvalue()))
    return dimensions


def supprimer_fichiers(stockage, nom):
    """Supprime l'original et toutes ses versions (quelles que soient les largeurs configurées à l'époque)."""
    if not nom:
        return
    dossier, fichier = os.path.split(nom)
    modele = re.compile(re.escape(_racine(fichier)) + r'-\d+w\.webp')
    try:
        _dossiers, fichiers = stockage.listdir(dossier)
    except (FileNotFoundError, NotImplementedError, OSError):
        fichiers = []
    for existant in fichiers:
        if modele.fullmatch(existant):
            stockage.delete(os.path.join(dossier, existant).replace('\\', '/'))
    stockage.delete(nom)


def url_version(fichier, taille='miniature'):
    """Adresse de la version `taille` (« miniature », « moyenne » ou « grande ») d'un champ image, ou de l'original
    si elle n'existe pas. Sert surtout à l'admin (aperçus)."""
    if not fichier:
        return ''
    cible = settings.IMAGE_LARGEURS[taille]
    objet, champ = fichier.instance, fichier.field
    nom_champ_largeur = getattr(champ, 'width_field', None)
    largeur = getattr(objet, nom_champ_largeur, None) if nom_champ_largeur else None
    if not largeur:
        return fichier.url
    choisie = min(largeur, cible)
    return fichier.storage.url(nom_version(fichier.name, choisie))


# ====================================================================================== branchement sur les modèles
def _avant_sauvegarde(sender, instance, champs, **_kw):
    """Repère les images nouvelles (à traiter) et programme la suppression de celles qui sont remplacées ou retirées.

    Une image est « nouvelle » quand son nom diffère de celui déjà enregistré en base. Cela couvre à la fois un envoi
    par formulaire ou depuis l'admin ET un enregistrement par du code (`champ.save(nom, contenu)`)."""
    ancien = sender.objects.filter(pk=instance.pk).first() if instance.pk else None
    nouvelles = []
    for champ in champs:
        fichier = getattr(instance, champ)
        nom_ancien = getattr(ancien, champ).name if ancien is not None else ''
        if fichier and fichier.name != nom_ancien:
            nouvelles.append(champ)
        if nom_ancien and nom_ancien != fichier.name:
            transaction.on_commit(lambda s=getattr(ancien, champ).storage, n=nom_ancien: supprimer_fichiers(s, n))
    instance._images_a_traiter = nouvelles


def _apres_sauvegarde(sender, instance, champs, **_kw):
    for champ in getattr(instance, '_images_a_traiter', []):
        fichier = getattr(instance, champ)
        if not fichier:
            continue

        def traiter(stockage=fichier.storage, nom=fichier.name, modele=sender, pk=instance.pk, champ_modele=instance._meta.get_field(champ)):
            try:
                largeur, hauteur = generer_versions(stockage, nom)
                # Les dimensions enregistrées doivent être celles de l'image REDRESSÉE (photos de téléphone), car les
                # largeurs du srcset en dépendent.
                corrections = {}
                if champ_modele.width_field:
                    corrections[champ_modele.width_field] = largeur
                if champ_modele.height_field:
                    corrections[champ_modele.height_field] = hauteur
                if corrections:
                    modele.objects.filter(pk=pk).update(**corrections)
            except Exception:   # une image abîmée ne doit jamais empêcher d'enregistrer la fiche
                journal.exception("Versions WebP non générées pour %s", nom)
        transaction.on_commit(traiter)
    instance._images_a_traiter = []


def _apres_suppression(sender, instance, champs, **_kw):
    for champ in champs:
        fichier = getattr(instance, champ)
        if fichier:
            transaction.on_commit(lambda s=fichier.storage, n=fichier.name: supprimer_fichiers(s, n))


def connecter(modeles_et_champs):
    """Branche le traitement des images sur les modèles : [(Modele, ('champ_image', …)), …]."""
    for modele, champs in modeles_et_champs:
        etiquette = f'images-{modele._meta.label_lower}'
        pre_save.connect(lambda sender, instance, c=champs, **kw: _avant_sauvegarde(sender, instance, c, **kw),
                         sender=modele, weak=False, dispatch_uid=f'{etiquette}-avant')
        post_save.connect(lambda sender, instance, c=champs, **kw: _apres_sauvegarde(sender, instance, c, **kw),
                          sender=modele, weak=False, dispatch_uid=f'{etiquette}-apres')
        post_delete.connect(lambda sender, instance, c=champs, **kw: _apres_suppression(sender, instance, c, **kw),
                            sender=modele, weak=False, dispatch_uid=f'{etiquette}-suppression')
