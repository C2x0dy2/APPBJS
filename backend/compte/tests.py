"""Tests des pages de compte. Chaque test crée ses données (fabriques) et vide le cache des tentatives."""
import json
import re
import time
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from ticketing.fabriques import creer_evenement, creer_utilisateur, parametres
from ticketing.models import PageLegale

from . import emails

MOT_DE_PASSE = 'motdepasse-test-123'
HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


@HACHAGE_RAPIDE
class ConnexionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.utilisateur = creer_utilisateur('anna@test.fr', MOT_DE_PASSE, first_name='Anna')
        self.url = reverse('compte:connexion')

    def connexion(self, email='anna@test.fr', mot_de_passe=MOT_DE_PASSE, **extra):
        return self.client.post(self.url, {'username': email, 'password': mot_de_passe, **extra})

    # -- identifiants
    def test_connexion_reussie_redirige_vers_mes_billets_avec_un_message_de_bienvenue(self):
        reponse = self.connexion()
        self.assertRedirects(reponse, reverse('compte:mes_billets'), fetch_redirect_response=False)
        suite = self.client.get(reponse['Location'])
        self.assertContains(suite, 'Bienvenue, Anna !')
        self.assertEqual(self.client.get(reponse['Location']).context['user'], self.utilisateur)

    def test_message_de_bienvenue_sans_prenom(self):
        creer_utilisateur('sans-prenom@test.fr', MOT_DE_PASSE)
        reponse = self.connexion('sans-prenom@test.fr')
        self.assertContains(self.client.get(reponse['Location']), 'Bienvenue !')

    def test_mauvais_mot_de_passe_et_email_inconnu_donnent_le_meme_message(self):
        mauvais = self.connexion(mot_de_passe='faux')
        inconnu = self.connexion('inconnu@test.fr')
        self.assertEqual((mauvais.status_code, inconnu.status_code), (200, 200))
        message = 'E-mail ou mot de passe incorrect.'
        self.assertEqual(list(mauvais.context['form'].non_field_errors()), [message])
        self.assertEqual(list(inconnu.context['form'].non_field_errors()), [message])
        self.assertNotIn('_auth_user_id', self.client.session)

    def test_compte_desactive_donne_le_meme_message(self):
        get_user_model().objects.filter(pk=self.utilisateur.pk).update(is_active=False)
        reponse = self.connexion()
        self.assertEqual(list(reponse.context['form'].non_field_errors()), ['E-mail ou mot de passe incorrect.'])

    def test_email_normalise_espaces_et_casse(self):
        reponse = self.connexion('  ANNA@Test.FR ')
        self.assertEqual(reponse.status_code, 302)

    def test_le_mot_de_passe_n_est_jamais_reaffiche(self):
        reponse = self.connexion(mot_de_passe='un-secret-visible')
        self.assertNotContains(reponse, 'un-secret-visible')
        self.assertContains(reponse, 'value="anna@test.fr"')     # l'e-mail, lui, est conservé

    # -- redirection (next)
    def test_redirection_vers_next_interne(self):
        reponse = self.connexion(next=reverse('evenements'))
        self.assertRedirects(reponse, reverse('evenements'), fetch_redirect_response=False)

    def test_next_externe_refuse(self):
        for adresse in ['https://evil.example/', '//evil.example/', 'javascript:alert(1)']:
            with self.subTest(adresse=adresse):
                cache.clear()
                self.client.logout()
                reponse = self.connexion(next=adresse)
                self.assertRedirects(reponse, reverse('compte:mes_billets'), fetch_redirect_response=False)

    def test_utilisateur_deja_connecte_est_redirige(self):
        self.client.force_login(self.utilisateur)
        self.assertRedirects(self.client.get(self.url), reverse('compte:mes_billets'), fetch_redirect_response=False)
        self.assertRedirects(self.client.get(self.url, {'next': reverse('evenements')}), reverse('evenements'),
                             fetch_redirect_response=False)

    def test_page_protegee_renvoie_vers_la_connexion_avec_next(self):
        reponse = self.client.get(reverse('compte:mes_billets'))
        self.assertRedirects(reponse, f"{self.url}?next={reverse('compte:mes_billets')}", fetch_redirect_response=False)

    # -- rester connecté
    def test_session_courte_sans_rester_connecte_longue_avec(self):
        self.connexion()
        self.assertTrue(self.client.session.get_expire_at_browser_close())
        self.client.logout()
        self.connexion(remember_me='on')
        self.assertFalse(self.client.session.get_expire_at_browser_close())

    # -- déconnexion
    def test_deconnexion_en_post_uniquement(self):
        self.client.force_login(self.utilisateur)
        url = reverse('compte:deconnexion')
        self.assertEqual(self.client.get(url).status_code, 405)
        self.assertIn('_auth_user_id', self.client.session)
        self.assertRedirects(self.client.post(url), reverse('accueil'), fetch_redirect_response=False)
        self.assertNotIn('_auth_user_id', self.client.session)

    # -- limitation des tentatives
    @override_settings(CONNEXION_TENTATIVES_MAX=3, CONNEXION_FENETRE_MINUTES=15)
    def test_trop_d_echecs_bloque_meme_avec_le_bon_mot_de_passe(self):
        for _ in range(3):
            self.assertEqual(self.connexion(mot_de_passe='faux').status_code, 200)
        reponse = self.connexion()   # bon mot de passe, mais déjà bloqué
        self.assertEqual(reponse.status_code, 429)
        self.assertContains(reponse, 'Trop de tentatives, réessaie dans 15 minutes.', status_code=429)
        self.assertNotIn('_auth_user_id', self.client.session)

    @override_settings(CONNEXION_TENTATIVES_MAX=3)
    def test_le_blocage_est_propre_a_chaque_email(self):
        for _ in range(3):
            self.connexion(mot_de_passe='faux')
        autre = creer_utilisateur('autre@test.fr', MOT_DE_PASSE)
        self.assertEqual(self.connexion('autre@test.fr').status_code, 302)
        self.client.logout()
        self.assertEqual(self.connexion().status_code, 429)

    @override_settings(CONNEXION_TENTATIVES_MAX=3)
    def test_une_connexion_reussie_remet_le_compteur_a_zero(self):
        for _ in range(2):
            self.connexion(mot_de_passe='faux')
        self.assertEqual(self.connexion().status_code, 302)
        self.client.logout()
        for _ in range(2):
            self.assertEqual(self.connexion(mot_de_passe='faux').status_code, 200)   # il restait 3 essais, pas 1
        self.assertEqual(self.connexion().status_code, 302)

    @override_settings(CONNEXION_TENTATIVES_MAX=2, CONNEXION_FENETRE_MINUTES=1)
    def test_le_blocage_se_leve_a_la_fin_de_la_fenetre(self):
        from unittest import mock
        for _ in range(2):
            self.connexion(mot_de_passe='faux')
        self.assertEqual(self.connexion().status_code, 429)
        avenir = timezone.now().timestamp() + 61
        with mock.patch('compte.limitation.time.time', return_value=avenir):
            from compte import limitation
            requete = type('R', (), {'META': {'REMOTE_ADDR': '127.0.0.1'}})()
            self.assertEqual(limitation.minutes_restantes(requete, 'anna@test.fr'), 0)

    # -- réservation en cours
    def test_encart_de_reservation_en_cours(self):
        evenement, _ = creer_evenement(titre='Concert de la rentrée')
        reponse = self.client.get(self.url, {'next': reverse('evenement_detail', args=[evenement.slug])})
        self.assertContains(reponse, 'Connecte-toi pour finaliser ta réservation')
        self.assertContains(reponse, 'Concert de la rentrée')

    def test_pas_d_encart_pour_un_evenement_non_publie_ni_pour_une_autre_page(self):
        brouillon, _ = creer_evenement(titre='Brouillon secret', publie=False)
        for suivant in [reverse('evenement_detail', args=[brouillon.slug]), reverse('evenements'), '']:
            with self.subTest(suivant=suivant):
                reponse = self.client.get(self.url, {'next': suivant})
                self.assertNotContains(reponse, 'Connecte-toi pour finaliser')
                self.assertNotContains(reponse, 'Brouillon secret')

    def test_le_next_est_conserve_dans_le_formulaire(self):
        reponse = self.client.get(self.url, {'next': reverse('evenements')})
        self.assertContains(reponse, f'name="next" value="{reverse("evenements")}"')


@HACHAGE_RAPIDE
class PageConnexionContenuTests(TestCase):
    """Rien n'est écrit en dur : le contenu éditorial vient de « Paramètres du site »."""

    def setUp(self):
        cache.clear()
        self.url = reverse('compte:connexion')

    def test_page_affichee_avec_des_parametres_vides(self):
        reponse = self.client.get(self.url)
        self.assertEqual(reponse.status_code, 200)
        self.assertContains(reponse, '<h1 class="sr-only">Connexion</h1>', html=True)   # un h1 existe toujours
        for absent in ['class="auth-titre"', 'auth-sous-titre', 'auth-arguments', 'auth-photo']:
            self.assertNotContains(reponse, absent)

    def test_le_contenu_saisi_s_affiche(self):
        parametres(auth_connexion_titre='Content de te *revoir*', auth_connexion_sous_titre='Un sous-titre saisi',
                   auth_arguments='Premier avantage\n\nSecond avantage', image_auth='site/test.jpg')
        reponse = self.client.get(self.url)
        self.assertContains(reponse, 'Content de te <em>revoir</em>')
        self.assertContains(reponse, 'Un sous-titre saisi')
        self.assertContains(reponse, '<li>Premier avantage</li>', html=True)
        self.assertContains(reponse, '<li>Second avantage</li>', html=True)
        self.assertContains(reponse, 'auth-photo')

    def test_le_texte_saisi_est_echappe(self):
        parametres(auth_connexion_titre='<img src=x onerror=alert(1)>', auth_arguments='<b>gras</b>')
        reponse = self.client.get(self.url)
        self.assertNotContains(reponse, '<img src=x')
        self.assertNotContains(reponse, '<b>gras</b>')

    def test_pas_de_navbar_complete_juste_le_logo_et_retour(self):
        reponse = self.client.get(self.url)
        self.assertNotContains(reponse, 'class="bar"')
        self.assertContains(reponse, 'data-retour')
        self.assertContains(reponse, 'Retour')

    def test_liens_vers_l_inscription_et_le_mot_de_passe_oublie_conservent_le_next(self):
        reponse = self.client.get(self.url, {'next': reverse('evenements')})
        self.assertContains(reponse, f'href="{reverse("compte:mdp_oublie")}"')
        self.assertContains(reponse, f'{reverse("compte:inscription")}?next=/evenements/')

    def test_accessibilite_du_formulaire(self):
        reponse = self.client.get(self.url)
        self.assertContains(reponse, 'type="email"')
        self.assertContains(reponse, 'autocomplete="email"')
        self.assertContains(reponse, 'inputmode="email"')
        self.assertContains(reponse, 'autocomplete="current-password"')
        self.assertContains(reponse, 'data-oeil=')
        self.assertContains(reponse, 'aria-pressed="false"')
        self.assertContains(reponse, 'csrfmiddlewaretoken')
        self.assertContains(reponse, 'for="id_username"')

    def test_erreur_de_champ_relie_au_message(self):
        reponse = self.client.post(self.url, {'username': 'pas-un-mail', 'password': 'x'})
        self.assertContains(reponse, 'aria-invalid="true"')
        self.assertContains(reponse, 'aria-describedby="id_username-erreur"')
        self.assertContains(reponse, 'id="id_username-erreur"')


@HACHAGE_RAPIDE
class NavigationCompteTests(TestCase):
    def test_le_bouton_compte_mene_a_la_connexion_puis_a_mes_billets(self):
        self.assertContains(self.client.get(reverse('accueil')), f'href="{reverse("compte:connexion")}"')
        self.client.force_login(creer_utilisateur('nav@test.fr'))
        suite = self.client.get(reverse('accueil'))
        self.assertContains(suite, f'href="{reverse("compte:mes_billets")}"')
        self.assertNotContains(suite, f'href="{reverse("compte:connexion")}"')


# ======================================================================================
# Inscription
# ======================================================================================
DONNEES_INSCRIPTION = {'first_name': 'Léa', 'last_name': 'Martin', 'email': 'lea@test.fr', 'password': 'Un-mot-de-passe-solide-42',
                       'accepte_cgv': 'on'}


@HACHAGE_RAPIDE
class InscriptionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.url = reverse('compte:inscription')

    def inscrire(self, **changements):
        donnees = {**DONNEES_INSCRIPTION, **changements}
        return self.client.post(self.url, {k: v for k, v in donnees.items() if v is not None})

    def test_inscription_reussie_connecte_directement_et_envoie_le_lien(self):
        reponse = self.inscrire()
        self.assertRedirects(reponse, reverse('compte:mes_billets'), fetch_redirect_response=False)
        utilisateur = get_user_model().objects.get(email='lea@test.fr')
        self.assertEqual(self.client.session['_auth_user_id'], str(utilisateur.pk))
        self.assertFalse(utilisateur.email_verifie)
        self.assertIsNotNone(utilisateur.cgv_acceptees_le)
        self.assertFalse(utilisateur.accepte_newsletter)          # jamais cochée par défaut
        self.assertEqual((utilisateur.first_name, utilisateur.last_name), ('Léa', 'Martin'))
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['lea@test.fr'])
        self.assertContains(self.client.get(reponse['Location']), 'Bienvenue, Léa !')

    def test_newsletter_seulement_si_cochee(self):
        self.inscrire(accepte_newsletter='on')
        self.assertTrue(get_user_model().objects.get(email='lea@test.fr').accepte_newsletter)

    def test_les_cases_ne_sont_pas_cochees_par_defaut(self):
        page = self.client.get(self.url).content.decode()
        self.assertNotRegex(page, r'<input[^>]*name="accepte_newsletter"[^>]*checked')
        self.assertNotRegex(page, r'<input[^>]*name="accepte_cgv"[^>]*checked')

    def test_refus_sans_cgv(self):
        reponse = self.inscrire(accepte_cgv=None)
        self.assertEqual(reponse.status_code, 200)
        self.assertContains(reponse, 'Tu dois accepter les CGV et la politique de confidentialité')
        self.assertFalse(get_user_model().objects.filter(email='lea@test.fr').exists())
        self.assertEqual(len(mail.outbox), 0)

    def test_refus_si_l_email_existe_deja_meme_avec_une_casse_differente(self):
        creer_utilisateur('lea@test.fr', MOT_DE_PASSE)
        for saisie in ['lea@test.fr', 'LEA@Test.FR', '  Lea@test.fr ']:
            with self.subTest(saisie=saisie):
                reponse = self.inscrire(email=saisie)
                self.assertEqual(reponse.status_code, 200)
                self.assertContains(reponse, 'Un compte existe déjà avec cette adresse e-mail.')
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_mots_de_passe_refuses_par_les_validateurs(self):
        for mauvais in ['court', '12345678901', 'password', 'lea@test.fr']:
            with self.subTest(mot_de_passe=mauvais):
                reponse = self.inscrire(password=mauvais)
                self.assertEqual(reponse.status_code, 200)
                self.assertTrue(reponse.context['form'].errors.get('password'))
        self.assertFalse(get_user_model().objects.exists())

    def test_champs_obligatoires_et_email_invalide(self):
        reponse = self.inscrire(first_name='', last_name='', email='pas-un-mail')
        for champ in ('first_name', 'last_name', 'email'):
            self.assertIn(champ, reponse.context['form'].errors)

    def test_valeurs_conservees_sauf_le_mot_de_passe(self):
        reponse = self.inscrire(email='pas-un-mail', password='Un-mot-de-passe-solide-42')
        self.assertContains(reponse, 'value="Léa"')
        self.assertContains(reponse, 'value="Martin"')
        self.assertNotContains(reponse, 'Un-mot-de-passe-solide-42')

    def test_redirection_vers_next_interne_et_refus_du_next_externe(self):
        reponse = self.inscrire(next=reverse('evenements'))
        self.assertRedirects(reponse, reverse('evenements'), fetch_redirect_response=False)
        self.client.logout()
        get_user_model().objects.all().delete()
        reponse = self.inscrire(next='https://evil.example/')
        self.assertRedirects(reponse, reverse('compte:mes_billets'), fetch_redirect_response=False)

    def test_utilisateur_connecte_est_redirige(self):
        self.client.force_login(creer_utilisateur('deja@test.fr', MOT_DE_PASSE))
        self.assertRedirects(self.client.get(self.url), reverse('compte:mes_billets'), fetch_redirect_response=False)

    def test_encart_de_reservation_en_cours(self):
        evenement, _ = creer_evenement(titre='Concert à ne pas rater')
        reponse = self.client.get(self.url, {'next': reverse('evenement_detail', args=[evenement.slug])})
        self.assertContains(reponse, 'Concert à ne pas rater')
        self.assertContains(reponse, 'Crée ton compte pour finaliser ta réservation')

    def test_le_lien_de_connexion_conserve_le_next(self):
        reponse = self.client.get(self.url, {'next': reverse('evenements')})
        self.assertContains(reponse, f'{reverse("compte:connexion")}?next=/evenements/')

    def test_accessibilite_du_formulaire(self):
        reponse = self.client.get(self.url)
        for attendu in ['autocomplete="given-name"', 'autocomplete="family-name"', 'autocomplete="email"',
                        'autocomplete="new-password"', 'type="email"', 'data-oeil=', 'data-force-champ=', 'data-regle="longueur"']:
            self.assertContains(reponse, attendu)
        self.assertNotContains(reponse, 'confirm')       # pas de champ « confirmer le mot de passe »

    def test_indicateur_de_force_utilise_la_longueur_minimale_reelle(self):
        self.assertContains(self.client.get(self.url), 'data-longueur-min="8"')


@HACHAGE_RAPIDE
class InscriptionContenuTests(TestCase):
    def setUp(self):
        self.url = reverse('compte:inscription')

    def test_page_affichee_avec_des_parametres_vides(self):
        reponse = self.client.get(self.url)
        self.assertEqual(reponse.status_code, 200)
        self.assertContains(reponse, '<h1 class="sr-only">Inscription</h1>', html=True)
        for absent in ['class="auth-titre"', 'auth-sous-titre', 'auth-arguments', 'auth-photo']:
            self.assertNotContains(reponse, absent)

    def test_titre_et_sous_titre_saisis(self):
        parametres(auth_inscription_titre='Rejoins la *fosse*', auth_inscription_sous_titre='Un sous-titre saisi')
        reponse = self.client.get(self.url)
        self.assertContains(reponse, 'Rejoins la <em>fosse</em>')
        self.assertContains(reponse, 'Un sous-titre saisi')

    def test_liens_cgv_et_confidentialite_seulement_si_les_pages_sont_publiees(self):
        reponse = self.client.get(self.url)
        self.assertContains(reponse, 'les CGV')                      # le texte de la case reste
        self.assertNotContains(reponse, 'target="_blank"')           # mais aucun lien
        cgv = PageLegale.objects.create(titre='Conditions générales', contenu='Texte des CGV.')
        confidentialite = PageLegale.objects.create(titre='Confidentialité', contenu='Texte.', publiee=False)
        parametres(page_cgv=cgv, page_confidentialite=confidentialite)
        reponse = self.client.get(self.url)
        self.assertContains(reponse, f'href="{reverse("page_legale", args=[cgv.slug])}" target="_blank" rel="noopener"')
        self.assertNotContains(reponse, reverse('page_legale', args=[confidentialite.slug]))   # non publiée : pas de lien


class PageLegaleTests(TestCase):
    def test_page_publiee_affichee_et_echappee(self):
        page = PageLegale.objects.create(titre='Mentions', contenu='Première ligne\n<script>alert(1)</script>')
        reponse = self.client.get(reverse('page_legale', args=[page.slug]))
        self.assertContains(reponse, 'Première ligne')
        self.assertNotContains(reponse, '<script>alert(1)</script>')

    def test_page_non_publiee_ou_inconnue_donne_404(self):
        brouillon = PageLegale.objects.create(titre='Brouillon', publiee=False)
        self.assertEqual(self.client.get(reverse('page_legale', args=[brouillon.slug])).status_code, 404)
        self.assertEqual(self.client.get(reverse('page_legale', args=['inconnue'])).status_code, 404)


# ======================================================================================
# Vérification de l'e-mail et paiement
# ======================================================================================
@HACHAGE_RAPIDE
class VerificationEmailTests(TestCase):
    def setUp(self):
        cache.clear()
        self.utilisateur = creer_utilisateur('verif@test.fr', MOT_DE_PASSE, first_name='Vera')

    def lien(self, utilisateur=None):
        return reverse('compte:verifier_email', args=[emails.fabriquer_jeton(utilisateur or self.utilisateur)])

    def test_lien_valide_verifie_l_adresse(self):
        reponse = self.client.get(self.lien())
        self.assertContains(reponse, 'Ton adresse e-mail est vérifiée')
        self.utilisateur.refresh_from_db()
        self.assertTrue(self.utilisateur.email_verifie)

    def test_lien_invalide_ne_change_rien(self):
        reponse = self.client.get(reverse('compte:verifier_email', args=['n-importe-quoi']))
        self.assertEqual(reponse.status_code, 200)
        self.assertContains(reponse, "Ce lien n'est plus valable")
        self.utilisateur.refresh_from_db()
        self.assertFalse(self.utilisateur.email_verifie)

    def test_lien_expire_refuse(self):
        from unittest import mock
        lien = self.lien()
        with mock.patch('django.core.signing.time.time', return_value=time.time() + 4 * 86400):   # réglage : 3 jours
            reponse = self.client.get(lien)
        self.assertContains(reponse, "Ce lien n'est plus valable")
        self.utilisateur.refresh_from_db()
        self.assertFalse(self.utilisateur.email_verifie)

    def test_lien_devient_invalide_si_l_adresse_a_change(self):
        lien = self.lien()
        get_user_model().objects.filter(pk=self.utilisateur.pk).update(email='autre@test.fr')
        self.client.get(lien)
        self.utilisateur.refresh_from_db()
        self.assertFalse(self.utilisateur.email_verifie)

    def test_contenu_de_l_e_mail_de_verification(self):
        parametres(nom_site='Mon Site', email_signature='L\'équipe de test')
        emails.envoyer_verification(RequestFactory().get('/'), self.utilisateur)
        message = mail.outbox[0]
        self.assertEqual(message.subject, 'Vérifie ton adresse e-mail')
        self.assertTrue(message.from_email.startswith('Mon Site <'))          # nom d'expéditeur : celui du site
        self.assertIn('Salut Vera,', message.body)
        self.assertIn("L'équipe de test", message.body)                        # signature depuis les paramètres
        self.assertIn('/compte/verification/', message.body)
        html = message.alternatives[0][0]
        self.assertIn('Vérifier mon e-mail', html)
        self.assertIn("L&#x27;équipe de test", html)
        self.assertIn('#5a1b9e', html)                                          # couleurs du site

    def test_signature_absente_si_non_saisie(self):
        emails.envoyer_verification(RequestFactory().get('/'), self.utilisateur)
        self.assertNotIn("L'équipe", mail.outbox[0].body)

    # -- renvoi du lien
    def test_renvoi_reserve_aux_connectes_et_en_post(self):
        url = reverse('compte:renvoyer_verification')
        self.assertEqual(self.client.post(url).status_code, 302)           # anonyme : renvoyé vers la connexion
        self.assertEqual(len(mail.outbox), 0)
        self.client.force_login(self.utilisateur)
        self.assertEqual(self.client.get(url).status_code, 405)

    def test_renvoi_une_seule_fois_par_delai(self):
        self.client.force_login(self.utilisateur)
        url = reverse('compte:renvoyer_verification')
        self.client.post(url)
        self.client.post(url)
        self.assertEqual(len(mail.outbox), 1)
        suite = self.client.get(reverse('accueil'))
        self.assertContains(suite, 'Patiente un peu avant de demander un nouveau lien.')

    def test_pas_de_renvoi_si_deja_verifie(self):
        get_user_model().objects.filter(pk=self.utilisateur.pk).update(email_verifie=True)
        self.client.force_login(get_user_model().objects.get(pk=self.utilisateur.pk))
        self.client.post(reverse('compte:renvoyer_verification'))
        self.assertEqual(len(mail.outbox), 0)

    # -- bandeau
    def test_bandeau_visible_seulement_pour_un_compte_non_verifie(self):
        self.assertNotContains(self.client.get(reverse('accueil')), 'bandeau-verif')
        self.client.force_login(self.utilisateur)
        reponse = self.client.get(reverse('accueil'))
        self.assertContains(reponse, 'Vérifie ton e-mail pour pouvoir payer')
        self.assertContains(reponse, 'Renvoyer le lien')
        get_user_model().objects.filter(pk=self.utilisateur.pk).update(email_verifie=True)
        self.client.force_login(get_user_model().objects.get(pk=self.utilisateur.pk))
        self.assertNotContains(self.client.get(reverse('accueil')), 'bandeau-verif')

    def test_le_superuser_est_verifie_d_office(self):
        self.assertTrue(get_user_model().objects.create_superuser(email='root@test.fr', password='x' * 12).email_verifie)

    # -- paiement refusé tant que l'e-mail n'est pas vérifié
    def reserver(self, evenement, type_place):
        return self.client.post(
            reverse('api_reserver', args=[evenement.id]),
            json.dumps({'email': 'verif@test.fr', 'items': [{'ticket_type': type_place.id, 'quantity': 1}]}),
            content_type='application/json')

    def test_reservation_refusee_tant_que_l_email_n_est_pas_verifie(self):
        evenement, type_place = creer_evenement()
        self.client.force_login(self.utilisateur)
        reponse = self.reserver(evenement, type_place)
        self.assertEqual(reponse.status_code, 403)
        self.assertEqual(reponse.json()['error'], 'Vérifie ton adresse e-mail avant de payer.')
        get_user_model().objects.filter(pk=self.utilisateur.pk).update(email_verifie=True)
        self.client.force_login(get_user_model().objects.get(pk=self.utilisateur.pk))
        self.assertEqual(self.reserver(evenement, type_place).status_code, 201)

    def test_reservation_sans_compte_reste_possible(self):
        evenement, type_place = creer_evenement()
        self.assertEqual(self.reserver(evenement, type_place).status_code, 201)


# ======================================================================================
# Mot de passe oublié, de bout en bout
# ======================================================================================
@HACHAGE_RAPIDE
class MotDePasseOublieTests(TestCase):
    def setUp(self):
        cache.clear()
        self.utilisateur = creer_utilisateur('oubli@test.fr', MOT_DE_PASSE, first_name='Oscar')

    def demander(self, email='oubli@test.fr'):
        return self.client.post(reverse('compte:mdp_oublie'), {'email': email})

    def lien_recu(self):
        return re.search(r'http://testserver(/compte/mot-de-passe/nouveau/\S+)', mail.outbox[-1].body).group(1)

    def test_les_quatre_pages_s_affichent_meme_avec_des_parametres_vides(self):
        for nom in ['compte:mdp_oublie', 'compte:mdp_envoye', 'compte:mdp_termine']:
            with self.subTest(page=nom):
                self.assertEqual(self.client.get(reverse(nom)).status_code, 200)
        invalide = reverse('compte:mdp_nouveau', args=['MQ', 'jeton-invalide'])
        self.assertContains(self.client.get(invalide), 'Demander un nouveau lien')

    def test_meme_reponse_que_le_compte_existe_ou_non(self):
        existant = self.demander()
        inconnu = self.demander('personne@test.fr')
        self.assertEqual((existant.status_code, inconnu.status_code), (302, 302))
        self.assertEqual(existant['Location'], inconnu['Location'])
        self.assertEqual(len(mail.outbox), 1)                          # un e-mail pour le compte existant seulement
        self.assertContains(self.client.get(existant['Location']), 'Si un compte existe avec cette adresse')

    def test_contenu_de_l_e_mail_de_reinitialisation(self):
        parametres(nom_site='Mon Site', email_signature='La signature')
        self.demander()
        message = mail.outbox[0]
        self.assertEqual(message.subject, 'Réinitialisation de ton mot de passe')
        self.assertTrue(message.from_email.startswith('Mon Site <'))
        self.assertIn('La signature', message.body)
        self.assertIn('Choisir un nouveau mot de passe', message.alternatives[0][0])
        self.assertIn('/compte/mot-de-passe/nouveau/', message.alternatives[0][0])

    def test_parcours_complet_puis_connexion_avec_le_nouveau_mot_de_passe(self):
        self.demander()
        suite = self.client.get(self.lien_recu(), follow=True)          # Django redirige vers l'adresse « set-password »
        self.assertContains(suite, 'data-force-champ=')                  # indicateur de force sur le nouveau mot de passe
        adresse = suite.redirect_chain[-1][0]
        fin = self.client.post(adresse, {'new_password1': 'Nouveau-mot-de-passe-77'})
        self.assertRedirects(fin, reverse('compte:mdp_termine'), fetch_redirect_response=False)
        self.assertContains(self.client.get(fin['Location']), 'Ton mot de passe a bien été modifié')
        self.assertIsNone(authenticate(email='oubli@test.fr', password=MOT_DE_PASSE))
        self.assertIsNotNone(authenticate(email='oubli@test.fr', password='Nouveau-mot-de-passe-77'))
        self.utilisateur.refresh_from_db()
        self.assertTrue(self.utilisateur.email_verifie)                  # le lien reçu prouve que l'adresse est la bonne

    def test_lien_deja_utilise_refuse(self):
        self.demander()
        lien = self.lien_recu()
        suite = self.client.get(lien, follow=True)
        self.client.post(suite.redirect_chain[-1][0], {'new_password1': 'Nouveau-mot-de-passe-77'})
        autre = self.client_class()
        reponse = autre.get(lien, follow=True)
        self.assertContains(reponse, "Ce lien n'est plus valable")
        self.assertContains(reponse, 'Demander un nouveau lien')

    def test_lien_expire_refuse_avec_un_bouton_pour_en_redemander_un(self):
        from datetime import datetime, timedelta as delta
        from unittest import mock

        from django.contrib.auth.tokens import PasswordResetTokenGenerator
        self.demander()
        lien = self.lien_recu()
        with mock.patch.object(PasswordResetTokenGenerator, '_now', return_value=datetime.now() + delta(days=5)):
            reponse = self.client.get(lien, follow=True)
        self.assertContains(reponse, "Ce lien n'est plus valable")
        self.assertContains(reponse, reverse('compte:mdp_oublie'))

    def test_nouveau_mot_de_passe_faible_refuse(self):
        self.demander()
        suite = self.client.get(self.lien_recu(), follow=True)
        reponse = self.client.post(suite.redirect_chain[-1][0], {'new_password1': '12345678'})
        self.assertEqual(reponse.status_code, 200)
        self.assertTrue(reponse.context['form'].errors.get('new_password1'))
        self.assertIsNotNone(authenticate(email='oubli@test.fr', password=MOT_DE_PASSE))   # inchangé

    def test_comptes_desactives_ne_recoivent_rien(self):
        get_user_model().objects.filter(pk=self.utilisateur.pk).update(is_active=False)
        self.demander()
        self.assertEqual(len(mail.outbox), 0)
