"""
E-mails du compte (vérification de l'adresse, mot de passe oublié).

Chaque e-mail a une version HTML (aux couleurs du site) et une version texte. L'expéditeur et la signature viennent de
« Paramètres du site ». Les liens ouvrent l'APPLICATION (adresse FRONT_URL du fichier .env) : c'est elle qui affiche
l'écran de vérification ou de nouveau mot de passe, puis appelle l'API.
"""
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.utils.translation import gettext as _

from ticketing.models import ParametresSite

# Les e-mails n'acceptent pas les variables CSS : les couleurs sont écrites ici, à UN seul endroit (violet du logo,
# jaune d'accent, fonds clairs).
COULEURS_EMAIL = {'violet': '#5a1b9e', 'jaune': '#f4a62a', 'texte_bouton': '#35106a', 'creme': '#fffaf3', 'encre': '#1d0b33', 'gris': '#6b5d78'}

SEL_VERIFICATION = 'verification-email'


def lien_application(chemin):
    """Adresse d'un écran de l'application, par exemple '/verify-email/<jeton>'."""
    return settings.FRONT_URL.rstrip('/') + chemin


def contexte_email(**extra):
    parametres = ParametresSite.charger()
    return {'site': parametres, 'couleurs': COULEURS_EMAIL, 'signature': parametres.email_signature, **extra}


def expediteur():
    """« Nom <adresse> » : le nom vient des paramètres du site, l'adresse du fichier .env (DEFAULT_FROM_EMAIL)."""
    parametres = ParametresSite.charger()
    adresse = settings.DEFAULT_FROM_EMAIL or 'webmaster@localhost'
    nom = (parametres.email_expediteur_nom or parametres.nom_site).replace('"', '').replace('<', '').replace('>', '').strip()
    return f'{nom} <{adresse}>' if nom else adresse


def envoyer(sujet, modele, contexte, destinataire):
    """Envoie un e-mail à partir de emails/<modele>.txt et emails/<modele>.html."""
    contexte = contexte_email(**contexte)
    message = EmailMultiAlternatives(sujet, render_to_string(f'emails/{modele}.txt', contexte), expediteur(), [destinataire])
    message.attach_alternative(render_to_string(f'emails/{modele}.html', contexte), 'text/html')
    message.send()


# ----------------------------------------------------------------- vérification de l'adresse e-mail
def fabriquer_jeton(utilisateur):
    """Jeton signé (et daté) qui contient l'identifiant ET l'adresse : si l'adresse change, l'ancien lien ne marche plus."""
    return signing.dumps({'u': utilisateur.pk, 'e': utilisateur.email}, salt=SEL_VERIFICATION)


def lire_jeton(jeton):
    """Renvoie le contenu du jeton, ou lève signing.BadSignature (inclut SignatureExpired)."""
    return signing.loads(jeton, salt=SEL_VERIFICATION, max_age=settings.VERIFICATION_EMAIL_JOURS * 86400)


def envoyer_verification(utilisateur):
    envoyer(_('Vérifie ton adresse e-mail'), 'verification',
            {'prenom': utilisateur.first_name, 'nom_utilisateur': utilisateur.username,
             'lien': lien_application(f'/verify-email/{fabriquer_jeton(utilisateur)}'),
             'jours': settings.VERIFICATION_EMAIL_JOURS}, utilisateur.email)


# ----------------------------------------------------------------- mot de passe oublié
def envoyer_reinitialisation(utilisateur):
    """Lien à usage unique : il devient invalide dès que le mot de passe change (jeton de Django)."""
    uid = urlsafe_base64_encode(force_bytes(utilisateur.pk))
    jeton = default_token_generator.make_token(utilisateur)
    envoyer(_('Réinitialisation de ton mot de passe'), 'mdp_reinit',
            {'lien': lien_application(f'/reset-password/{uid}/{jeton}'), 'nom_utilisateur': utilisateur.username}, utilisateur.email)
