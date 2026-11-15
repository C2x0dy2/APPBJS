from django.apps import AppConfig


class TicketingConfig(AppConfig):
    name = 'ticketing'

    def ready(self):
        # Les images des modèles ci-dessous sont traitées automatiquement : versions WebP à l'enregistrement,
        # suppression des fichiers quand une image est remplacée ou supprimée (voir images.py).
        from . import images
        from .models import Categorie, Evenement, ImageEvenement, ImageLieu, Lieu
        images.connecter([
            (Evenement, ('image_principale',)),
            (ImageEvenement, ('image',)),
            (Lieu, ('photo_principale',)),
            (ImageLieu, ('image',)),
            (Categorie, ('illustration',)),
        ])
