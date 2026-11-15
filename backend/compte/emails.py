"""
E-mails du compte (vérification de l'adresse, mot de passe oublié).

Chaque e-mail a une version HTML (aux couleurs du site) et une version texte. L'expéditeur et la
signature viennent de « Paramètres du site ». Les e-mails n'acceptent pas les variables CSS : les
couleurs sont donc recopiées ici, à UN seul endroit, depuis assets/css/variables.css.
"""
from django.conf import settings
from django.core import signing
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils.translation import gettext as _

from ticketing.models import ParametresSite

# Mêmes valeurs que dans assets/css/variables.css (les clients e-mail ne lisent pas les variables CSS).
COULEURS_EMAIL = {'violet': '#5a1b9e', 'jaune': '#f4a62a', 'texte_bouton': '#35106a', 'creme': '#fffaf3', 'encre': '#1d0b33', 'gris': '#6b5d78'}

SEL_VERIFICATION = 'verification-email'


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


def envoyer_verification(request, utilisateur):
    lien = request.build_absolute_uri(reverse('compte:verifier_email', args=[fabriquer_jeton(utilisateur)]))
    envoyer(_('Vérifie ton adresse e-mail'), 'verification',
            {'prenom': utilisateur.first_name, 'lien': lien, 'jours': settings.VERIFICATION_EMAIL_JOURS}, utilisateur.email)
