"""Formulaires du compte. Les libellés et messages sont traduisibles ; rien n'est écrit en dur côté contenu."""
from django import forms
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.forms import AuthenticationForm, PasswordResetForm
from django.core.exceptions import ValidationError
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from . import emails
from ticketing.models import valider_nom_utilisateur

from .limitation import normaliser_identifiant


def longueur_minimale_mdp():
    """Longueur minimale réellement exigée par AUTH_PASSWORD_VALIDATORS (sert à l'indicateur côté navigateur)."""
    for validateur in password_validation.get_default_password_validators():
        if hasattr(validateur, 'min_length'):
            return validateur.min_length
    return 8


def champ_email():
    return forms.EmailField(label=_('Adresse e-mail'), widget=forms.EmailInput(attrs={
        'autocomplete': 'email', 'inputmode': 'email', 'autocapitalize': 'none', 'spellcheck': 'false'}))


# ====================================================================================== connexion
class FormulaireConnexion(AuthenticationForm):
    """Connexion par nom d'utilisateur. Le message d'erreur est identique que le compte existe ou non."""
    username = forms.CharField(label=_("Nom d'utilisateur"), widget=forms.TextInput(attrs={
        'autocomplete': 'username', 'autocapitalize': 'none', 'spellcheck': 'false'}))
    password = forms.CharField(label=_('Mot de passe'), strip=False,
                               widget=forms.PasswordInput(attrs={'autocomplete': 'current-password'}))
    remember_me = forms.BooleanField(required=False, label=_('Rester connecté'))

    error_messages = {
        'invalid_login': _("Nom d'utilisateur ou mot de passe incorrect."),
        'inactive': _("Nom d'utilisateur ou mot de passe incorrect."),   # même message : on ne révèle rien sur le compte
    }

    def clean_username(self):
        return self.cleaned_data['username'].strip()   # la casse n'a pas d'importance : le compte est retrouvé sans en tenir compte


# ====================================================================================== inscription
class FormulaireInscription(forms.Form):
    username = forms.CharField(
        label=_("Nom d'utilisateur"), max_length=30, validators=valider_nom_utilisateur,
        help_text=_("C'est avec lui que tu te connecteras. 3 à 30 caractères : lettres, chiffres, point, tiret et tiret bas. Sans espace."),
        widget=forms.TextInput(attrs={'autocomplete': 'username', 'autocapitalize': 'none', 'spellcheck': 'false'}))
    first_name = forms.CharField(label=_('Prénom'), max_length=150, widget=forms.TextInput(attrs={'autocomplete': 'given-name'}))
    last_name = forms.CharField(label=_('Nom'), max_length=150, widget=forms.TextInput(attrs={'autocomplete': 'family-name'}))
    email = champ_email()
    password = forms.CharField(label=_('Mot de passe'), strip=False, widget=forms.PasswordInput(attrs={'autocomplete': 'new-password'}))
    accepte_cgv = forms.BooleanField(
        required=True, error_messages={'required': _("Tu dois accepter les CGV et la politique de confidentialité pour créer un compte.")})
    accepte_newsletter = forms.BooleanField(required=False)   # jamais cochée par défaut

    error_messages = {
        'email_existe': _('Un compte existe déjà avec cette adresse e-mail.'),
        'nom_pris': _("Ce nom d'utilisateur est déjà pris."),
    }

    def clean_username(self):
        nom = self.cleaned_data['username'].strip()
        if get_user_model().objects.filter(username__iexact=nom).exists():   # « Anna » et « anna » = même nom
            raise ValidationError(self.error_messages['nom_pris'], code='nom_pris')
        return nom

    def clean_first_name(self):
        return self.cleaned_data['first_name'].strip()

    def clean_last_name(self):
        return self.cleaned_data['last_name'].strip()

    def clean_email(self):
        email = normaliser_identifiant(self.cleaned_data['email'])
        if get_user_model().objects.filter(email__iexact=email).exists():   # insensible à la casse
            raise ValidationError(self.error_messages['email_existe'], code='email_existe')
        return email

    def clean(self):
        donnees = super().clean()
        mot_de_passe = donnees.get('password')
        if mot_de_passe:
            # Les vrais critères sont ceux de AUTH_PASSWORD_VALIDATORS (longueur, mots de passe courants, ressemblance…)
            utilisateur = get_user_model()(username=donnees.get('username', ''), email=donnees.get('email', ''), first_name=donnees.get('first_name', ''),
                                           last_name=donnees.get('last_name', ''))
            try:
                password_validation.validate_password(mot_de_passe, utilisateur)
            except ValidationError as erreur:
                self.add_error('password', erreur)
        return donnees

    def save(self):
        donnees = self.cleaned_data
        return get_user_model().objects.create_user(
            username=donnees['username'], email=donnees['email'], password=donnees['password'],
            first_name=donnees['first_name'], last_name=donnees['last_name'],
            accepte_newsletter=donnees['accepte_newsletter'], cgv_acceptees_le=timezone.now())


# ====================================================================================== mot de passe oublié
class FormulaireMdpOublie(PasswordResetForm):
    email = champ_email()

    def send_mail(self, subject_template_name, email_template_name, context, from_email, to_email, html_email_template_name=None):
        """Envoie l'e-mail avec l'expéditeur, la signature et les couleurs du site (voir emails.py)."""
        contexte = emails.contexte_email(**context)
        sujet = ''.join(render_to_string(subject_template_name, contexte).splitlines())
        from django.core.mail import EmailMultiAlternatives
        message = EmailMultiAlternatives(sujet, render_to_string(email_template_name, contexte), emails.expediteur(), [to_email])
        if html_email_template_name:
            message.attach_alternative(render_to_string(html_email_template_name, contexte), 'text/html')
        message.send()


class FormulaireNouveauMdp(forms.Form):
    """Nouveau mot de passe depuis le lien reçu par e-mail (un seul champ : le bouton œil suffit)."""
    new_password1 = forms.CharField(label=_('Nouveau mot de passe'), strip=False,
                                    widget=forms.PasswordInput(attrs={'autocomplete': 'new-password'}))

    def __init__(self, user, *args, **kwargs):
        self.user = user
        super().__init__(*args, **kwargs)

    def clean_new_password1(self):
        mot_de_passe = self.cleaned_data['new_password1']
        password_validation.validate_password(mot_de_passe, self.user)
        return mot_de_passe

    def save(self, commit=True):
        self.user.set_password(self.cleaned_data['new_password1'])
        if commit:
            self.user.save()
        return self.user
