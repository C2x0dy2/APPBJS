from django.core.management.base import BaseCommand

from ticketing import services


class Command(BaseCommand):
    help = (
        "Libère les places des réservations non payées dont le délai est dépassé (15 minutes par carte, 48 h par virement "
        "par défaut). À lancer régulièrement (toutes les minutes) par une tâche planifiée ; l'API le fait aussi à chaque "
        "consultation des places, donc rien ne reste bloqué entre deux passages. Peut être relancée sans risque."
    )

    def handle(self, *args, **options):
        n = services.liberer_retenues_expirees()
        self.stdout.write(f'{n} réservation(s) expirée(s) libérée(s).')
