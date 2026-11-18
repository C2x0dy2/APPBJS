"""
API du compte : inscription, connexion, déconnexion, profil, vérification de l'e-mail, mot de passe oublié.

Toutes les réponses sont du JSON. L'application s'identifie ensuite par un jeton (« Authorization: Bearer … »),
jamais par un cookie. Les règles sont celles du site d'origine : nom d'utilisateur de 3 à 30 caractères (insensible à
la casse), e-mail unique, mots de passe contrôlés par AUTH_PASSWORD_VALIDATORS, blocage temporaire après trop d'échecs.
"""
import logging

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.utils.translation import gettext as _

from ticketing.api_commun import ErreurApi, ErreurValidation, api, erreur, lire_json
from ticketing.jetons import creer_jeton, jeton_requis, revoquer_jetons
from ticketing.models import valider_nom_utilisateur
from ticketing.serialisation import utilisateur_json

from . import emails, limitation

journal = logging.getLogger(__name__)
Utilisateur = get_user_model()


def _texte(donnees, champ):
    valeur = donnees.get(champ, '')
    return valeur.strip() if isinstance(valeur, str) else ''


def _messages(erreur_validation):
    return ' '.join(erreur_validation.messages)


def _appareil(request):
    return request.headers.get('User-Agent', '')


def _envoyer_sans_echouer(envoi, utilisateur):
    """Un e-mail qui ne part pas (serveur de messagerie en panne) ne doit pas faire échouer l'inscription : le compte existe,
    et la personne pourra demander un nouveau lien."""
    try:
        envoi(utilisateur)
    except Exception:   # noqa: BLE001 : toute panne de messagerie
        journal.exception("Envoi d'e-mail impossible pour le compte %s", utilisateur.pk)


# ====================================================================================== inscription
@api('POST')
def inscription(request):
    donnees = lire_json(request)
    minutes = limitation.minutes_restantes(request, 'inscription', maximum=settings.DEMANDES_COMPTE_MAX)
    if minutes:
        return erreur('too_many_attempts', _('Trop de tentatives. Réessaie dans %(minutes)s min.') % {'minutes': minutes}, 429, retryAfterMinutes=minutes)
    limitation.enregistrer_echec(request, 'inscription')   # chaque tentative compte, réussie ou non : c'est un plafond par adresse IP

    nom, email, mot_de_passe = _texte(donnees, 'username'), limitation.normaliser_identifiant(donnees.get('email')), donnees.get('password') or ''
    erreurs = {}

    if not nom:
        erreurs['username'] = _("Choisis un nom d'utilisateur.")
    else:
        try:
            if len(nom) > 30:
                raise ValidationError(_("Le nom d'utilisateur ne doit pas dépasser 30 caractères."))
            for validateur in valider_nom_utilisateur:
                validateur(nom)
            if Utilisateur.objects.filter(username__iexact=nom).exists():   # « Anna » et « anna » = même nom
                raise ValidationError(_("Ce nom d'utilisateur est déjà pris."))
        except ValidationError as e:
            erreurs['username'] = _messages(e)

    if not email:
        erreurs['email'] = _('Saisis ton adresse e-mail.')
    else:
        try:
            validate_email(email)
            if Utilisateur.objects.filter(email__iexact=email).exists():
                raise ValidationError(_('Un compte existe déjà avec cette adresse e-mail.'))
        except ValidationError as e:
            erreurs['email'] = _messages(e)

    if not isinstance(mot_de_passe, str) or not mot_de_passe:
        erreurs['password'] = _('Choisis un mot de passe.')
    elif 'username' not in erreurs and 'email' not in erreurs:
        try:   # les vrais critères sont ceux de AUTH_PASSWORD_VALIDATORS (longueur, mots de passe courants, ressemblance…)
            password_validation.validate_password(mot_de_passe, Utilisateur(username=nom, email=email))
        except ValidationError as e:
            erreurs['password'] = _messages(e)

    if donnees.get('acceptTerms') is not True:
        erreurs['acceptTerms'] = _('Tu dois accepter les conditions pour créer un compte.')
    if erreurs:
        raise ErreurValidation(erreurs)

    utilisateur = Utilisateur.objects.create_user(
        username=nom, email=email, password=mot_de_passe,
        accepte_newsletter=donnees.get('newsletter') is True, cgv_acceptees_le=timezone.now())
    _envoyer_sans_echouer(emails.envoyer_verification, utilisateur)
    return JsonResponse({'token': creer_jeton(utilisateur, _appareil(request)), 'user': utilisateur_json(utilisateur)}, status=201)


# ====================================================================================== connexion
@api('POST')
def connexion(request):
    donnees = lire_json(request)
    nom, mot_de_passe = _texte(donnees, 'username'), donnees.get('password') or ''
    erreurs = {}
    if not nom:
        erreurs['username'] = _("Saisis ton nom d'utilisateur.")
    if not isinstance(mot_de_passe, str) or not mot_de_passe:
        erreurs['password'] = _('Saisis ton mot de passe.')
    if erreurs:
        raise ErreurValidation(erreurs)

    identifiant = limitation.normaliser_identifiant(nom)
    minutes = limitation.minutes_restantes(request, identifiant)
    if minutes:   # trop d'échecs : on n'essaie même pas d'authentifier, même si le mot de passe est bon
        return erreur('too_many_attempts', _('Trop de tentatives. Réessaie dans %(minutes)s min.') % {'minutes': minutes}, 429, retryAfterMinutes=minutes)

    utilisateur = authenticate(request, username=nom, password=mot_de_passe)
    if utilisateur is None:
        limitation.enregistrer_echec(request, identifiant)
        # Même message que le compte existe ou non : on ne révèle rien.
        return erreur('invalid_credentials', _("Nom d'utilisateur ou mot de passe incorrect."), 401)
    limitation.reinitialiser(request, identifiant)
    return JsonResponse({'token': creer_jeton(utilisateur, _appareil(request)), 'user': utilisateur_json(utilisateur)})


@api('POST')
@jeton_requis
def deconnexion(request):
    request.jeton.delete()   # ce jeton ne marchera plus ; les autres appareils restent connectés
    return HttpResponse(status=204)


@api('GET')
@jeton_requis
def moi(request):
    return JsonResponse(utilisateur_json(request.user))


# ====================================================================================== vérification de l'adresse e-mail
@api('POST')
def verifier_email(request):
    """Le lien reçu par e-mail ouvre l'application, qui envoie ici le jeton du lien. Aucune connexion n'est nécessaire."""
    jeton = _texte(lire_json(request), 'token')
    utilisateur = None
    try:
        contenu = emails.lire_jeton(jeton)
        utilisateur = Utilisateur.objects.filter(pk=contenu['u'], email=contenu['e']).first()
    except (signing.BadSignature, KeyError, TypeError):
        pass
    if utilisateur is None:
        raise ErreurApi('invalid_link', _("Ce lien n'est plus valable. Demande-en un nouveau depuis ton compte."), 400)
    if not utilisateur.email_verifie:
        utilisateur.email_verifie = True
        utilisateur.save(update_fields=['email_verifie'])
    return JsonResponse({'verified': True})


@api('POST')
@jeton_requis
def renvoyer_verification(request):
    utilisateur = request.user
    if utilisateur.email_verifie:
        return HttpResponse(status=204)
    if not cache.add(f'verification-renvoi:{utilisateur.pk}', 1, timeout=settings.RENVOI_VERIFICATION_SECONDES):
        return erreur('too_many_requests', _('Patiente un peu avant de demander un nouveau lien.'), 429,
                      retryAfterSeconds=settings.RENVOI_VERIFICATION_SECONDES)
    _envoyer_sans_echouer(emails.envoyer_verification, utilisateur)
    return HttpResponse(status=204)


# ====================================================================================== mot de passe oublié
@api('POST')
def mot_de_passe_oublie(request):
    """Même réponse (204) que l'adresse ait un compte ou non : on ne révèle jamais quelles adresses sont inscrites."""
    email = limitation.normaliser_identifiant(lire_json(request).get('email'))
    try:
        validate_email(email)
    except ValidationError:
        raise ErreurValidation({'email': _('Cette adresse e-mail ne semble pas valide.')})
    identifiant = f'mdp:{email}'
    minutes = limitation.minutes_restantes(request, identifiant, maximum=settings.DEMANDES_COMPTE_MAX)
    if minutes:
        return erreur('too_many_attempts', _('Trop de demandes. Réessaie dans %(minutes)s min.') % {'minutes': minutes}, 429, retryAfterMinutes=minutes)
    limitation.enregistrer_echec(request, identifiant)   # chaque demande compte : évite d'inonder une boîte mail
    for utilisateur in Utilisateur.objects.filter(email__iexact=email, is_active=True):
        if utilisateur.has_usable_password():
            _envoyer_sans_echouer(emails.envoyer_reinitialisation, utilisateur)
    return HttpResponse(status=204)


@api('POST')
def nouveau_mot_de_passe(request):
    donnees = lire_json(request)
    utilisateur = None
    try:
        utilisateur = Utilisateur.objects.get(pk=force_str(urlsafe_base64_decode(_texte(donnees, 'uid'))))
    except (TypeError, ValueError, OverflowError, Utilisateur.DoesNotExist, ValidationError):
        pass
    if utilisateur is None or not utilisateur.is_active or not default_token_generator.check_token(utilisateur, _texte(donnees, 'token')):
        raise ErreurApi('invalid_link', _("Ce lien n'est plus valable. Demande-en un nouveau."), 400)
    mot_de_passe = donnees.get('password') or ''
    try:
        if not isinstance(mot_de_passe, str) or not mot_de_passe:
            raise ValidationError(_('Choisis un mot de passe.'))
        password_validation.validate_password(mot_de_passe, utilisateur)
    except ValidationError as e:
        raise ErreurValidation({'password': _messages(e)})
    utilisateur.set_password(mot_de_passe)
    utilisateur.email_verifie = True   # avoir reçu le lien par e-mail prouve que l'adresse est la bonne
    utilisateur.save(update_fields=['password', 'email_verifie'])
    revoquer_jetons(utilisateur)   # tous les appareils doivent se reconnecter avec le nouveau mot de passe
    return HttpResponse(status=204)
