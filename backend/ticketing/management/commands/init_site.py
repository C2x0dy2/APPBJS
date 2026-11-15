from django.core.management.base import BaseCommand

from ticketing.models import ParametresSite


class Command(BaseCommand):
    help = (
        "Crée la structure vide nécessaire au site : la fiche « Paramètres du site ». "
        "Aucun contenu n'est inventé. Peut être relancée sans créer de doublon."
    )

    def handle(self, *args, **options):
        _, creee = ParametresSite.objects.get_or_create(pk=1)
        if creee:
            self.stdout.write(self.style.SUCCESS('Fiche « Paramètres du site » créée (vide).'))
        else:
            self.stdout.write('Fiche « Paramètres du site » déjà présente : rien à faire.')
        # Les rôles (administrateur, gestionnaire, contrôleur) sont des choix fixes du modèle Membre : rien à créer.
