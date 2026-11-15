from django.db import migrations


def verifier_administrateurs(apps, schema_editor):
    """Les comptes créés avant l'ajout de la vérification d'e-mail et qui sont administrateurs n'ont pas de lien à cliquer."""
    Utilisateur = apps.get_model('ticketing', 'Utilisateur')
    Utilisateur.objects.filter(is_staff=True).update(email_verifie=True)


class Migration(migrations.Migration):
    dependencies = [('ticketing', '0004_inscription_pages_legales')]
    operations = [migrations.RunPython(verifier_administrateurs, migrations.RunPython.noop)]
