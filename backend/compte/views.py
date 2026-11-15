"""Vues du compte : connexion, inscription, vérification de l'e-mail, mot de passe oublié, « Mes billets » (provisoire)."""
from urllib.parse import urlparse

from django.contrib import messages
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import (LoginView, PasswordResetCompleteView, PasswordResetConfirmView,
                                       PasswordResetDoneView, PasswordResetView)
from django.core import signing
from django.core.cache import cache
from django.conf import settings
from django.shortcuts import redirect, render
from django.urls import Resolver404, resolve, reverse, reverse_lazy
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.translation import gettext as _
from django.views.decorators.http import require_POST
from django.views.generic import FormView

from ticketing.models import Evenement, ParametresSite, Utilisateur

from . import emails, limitation
from .forms import (FormulaireConnexion, FormulaireInscription, FormulaireMdpOublie, FormulaireNouveauMdp,
                    longueur_minimale_mdp)


# ====================================================================================== outils
def evenement_depuis_adresse(adresse):
    """Si `adresse` est la fiche d'un événement publié, renvoie cet événement (sinon None).
    Sert à rappeler « la réservation en cours » quand on arrive sur la connexion depuis un événement."""
    if not adresse:
        return None
    try:
        correspondance = resolve(urlparse(adresse).path)
    except Resolver404:
        return None
    if correspondance.url_name != 'evenement_detail':
        return None
    return Evenement.objects.filter(slug=correspondance.kwargs.get('slug'), publie=True).select_related('categorie', 'lieu').first()


def adresse_suivante(request):
    """Le paramètre `next`, seulement s'il pointe vers ce site (jamais vers un site externe)."""
    adresse = request.POST.get('next') or request.GET.get('next') or ''
    if adresse and url_has_allowed_host_and_scheme(adresse, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        return adresse
    return ''


def message_bienvenue(request, utilisateur):
    nom = utilisateur.first_name or utilisateur.username   # le prénom s'il est connu, sinon le nom d'utilisateur
    messages.success(request, _('Bienvenue, %(prenom)s !') % {'prenom': nom})


class ContexteParametres:
    """Remet les réglages du site dans le contexte : certaines vues Django y mettent une variable `site` qui les masquerait."""

    def get_context_data(self, **kwargs):
        contexte = super().get_context_data(**kwargs)
        contexte['site'] = ParametresSite.charger()
        return contexte


# ====================================================================================== connexion
class VueConnexion(ContexteParametres, LoginView):
    template_name = 'compte/connexion.html'
    authentication_form = FormulaireConnexion
    redirect_authenticated_user = True   # déjà connecté : on renvoie vers `next` ou « Mes billets »

    def get_context_data(self, **kwargs):
        contexte = super().get_context_data(**kwargs)
        # get_redirect_url() ne renvoie que des adresses du même site (url_has_allowed_host_and_scheme)
        contexte['evenement_en_cours'] = evenement_depuis_adresse(self.get_redirect_url())
        return contexte

    def post(self, request, *args, **kwargs):
        identifiant = limitation.normaliser_identifiant(request.POST.get('username'))
        minutes = limitation.minutes_restantes(request, identifiant)
        if minutes:
            # Trop d'échecs : on n'essaie même pas d'authentifier, même si le mot de passe est bon.
            reponse = self.render_to_response(self.get_context_data(form=self.get_form(), bloque_minutes=minutes))
            reponse.status_code = 429
            return reponse
        return super().post(request, *args, **kwargs)

    def form_invalid(self, form):
        limitation.enregistrer_echec(self.request, limitation.normaliser_identifiant(self.request.POST.get('username')))
        return super().form_invalid(form)

    def form_valid(self, form):
        reponse = super().form_valid(form)   # connecte l'utilisateur
        limitation.reinitialiser(self.request, limitation.normaliser_identifiant(form.cleaned_data['username']))
        if not form.cleaned_data.get('remember_me'):
            self.request.session.set_expiry(0)   # la session s'arrête à la fermeture du navigateur
        message_bienvenue(self.request, form.get_user())
        return reponse


# ====================================================================================== inscription
class VueInscription(FormView):
    template_name = 'compte/inscription.html'
    form_class = FormulaireInscription

    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:   # déjà connecté : on renvoie vers son compte
            return redirect(adresse_suivante(request) or settings.LOGIN_REDIRECT_URL)
        return super().dispatch(request, *args, **kwargs)

    def get_context_data(self, **kwargs):
        contexte = super().get_context_data(**kwargs)
        suivant = adresse_suivante(self.request)
        contexte.update({'next': suivant, 'evenement_en_cours': evenement_depuis_adresse(suivant),
                         'longueur_min': longueur_minimale_mdp()})
        return contexte

    def form_valid(self, form):
        utilisateur = form.save()
        login(self.request, utilisateur, backend='django.contrib.auth.backends.ModelBackend')   # connecté directement
        emails.envoyer_verification(self.request, utilisateur)
        message_bienvenue(self.request, utilisateur)
        return redirect(adresse_suivante(self.request) or settings.LOGIN_REDIRECT_URL)


# ====================================================================================== vérification de l'e-mail
def verifier_email(request, jeton):
    """Lien reçu par e-mail. Valide si la signature est bonne, non expirée, et si l'adresse n'a pas changé depuis."""
    utilisateur = None
    try:
        contenu = emails.lire_jeton(jeton)
        utilisateur = Utilisateur.objects.filter(pk=contenu['u'], email=contenu['e']).first()
    except (signing.BadSignature, KeyError, TypeError):
        pass
    if utilisateur is not None and not utilisateur.email_verifie:
        utilisateur.email_verifie = True
        utilisateur.save(update_fields=['email_verifie'])
    return render(request, 'compte/verification_email.html', {'valide': utilisateur is not None, 'site': ParametresSite.charger()})


@require_POST
@login_required
def renvoyer_verification(request):
    utilisateur = request.user
    if utilisateur.email_verifie:
        messages.info(request, _('Ton adresse e-mail est déjà vérifiée.'))
    else:
        cle = f'verification-renvoi:{utilisateur.pk}'
        if cache.add(cle, 1, timeout=settings.RENVOI_VERIFICATION_SECONDES):   # un renvoi par minute au plus
            emails.envoyer_verification(request, utilisateur)
            messages.success(request, _('Lien envoyé : regarde ta boîte mail.'))
        else:
            messages.warning(request, _('Patiente un peu avant de demander un nouveau lien.'))
    return redirect(adresse_suivante(request) or settings.LOGIN_REDIRECT_URL)


# ====================================================================================== mot de passe oublié
class VueMdpOublie(ContexteParametres, PasswordResetView):
    template_name = 'compte/mdp_oublie.html'
    form_class = FormulaireMdpOublie
    email_template_name = 'emails/mdp_reinit.txt'
    html_email_template_name = 'emails/mdp_reinit.html'
    subject_template_name = 'emails/mdp_reinit_sujet.txt'
    success_url = reverse_lazy('compte:mdp_envoye')   # même page que le compte existe ou non


class VueMdpEnvoye(ContexteParametres, PasswordResetDoneView):
    template_name = 'compte/mdp_envoye.html'


class VueMdpNouveau(ContexteParametres, PasswordResetConfirmView):
    template_name = 'compte/mdp_nouveau.html'
    form_class = FormulaireNouveauMdp
    success_url = reverse_lazy('compte:mdp_termine')

    def get_context_data(self, **kwargs):
        contexte = super().get_context_data(**kwargs)
        contexte['longueur_min'] = longueur_minimale_mdp()
        return contexte

    def form_valid(self, form):
        reponse = super().form_valid(form)
        # Avoir reçu le lien par e-mail prouve que l'adresse est la bonne.
        Utilisateur.objects.filter(pk=form.user.pk, email_verifie=False).update(email_verifie=True)
        return reponse


class VueMdpTermine(ContexteParametres, PasswordResetCompleteView):
    template_name = 'compte/mdp_termine.html'


# ====================================================================================== provisoire
@login_required
def mes_billets(request):
    """Page provisoire : les billets de l'utilisateur seront listés à l'étape « Espace acheteur »."""
    return render(request, 'compte/mes_billets.html')


# ====================================================================================== jeton CSRF périmé
def echec_csrf(request, reason=''):
    """Appelée par Django quand la vérification CSRF échoue (jeton absent, périmé ou différent du cookie).

    Cas le plus fréquent : une page de formulaire restée ouverte, ou ouverte dans deux onglets (la connexion dans l'un
    change le jeton de l'autre). On affiche donc un message humain avec un bouton pour recharger le formulaire.
    Si la personne est en réalité DÉJÀ connectée, on la renvoie directement vers son compte."""
    try:
        nom_vue = resolve(request.path).view_name
    except Resolver404:
        nom_vue = ''
    if request.user.is_authenticated and nom_vue in ('compte:connexion', 'compte:inscription'):
        return redirect(adresse_suivante(request) or settings.LOGIN_REDIRECT_URL)
    pages_a_recharger = {'compte:connexion', 'compte:inscription', 'compte:mdp_oublie'}
    retour = reverse(nom_vue) if nom_vue in pages_a_recharger else reverse('accueil')
    return render(request, 'compte/echec_csrf.html', {'url_retour': retour, 'site': ParametresSite.charger()}, status=403)
