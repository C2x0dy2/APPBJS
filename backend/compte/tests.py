"""
Tests de l'API du compte (compte/api.py) : inscription, connexion, jeton, vérification de l'e-mail, mot de passe oublié.
Chaque test crée ses propres données : rien n'est écrit dans l'application.
"""
import re
from datetime import timedelta
from unittest import mock

from django.core import mail, signing
from django.core.cache import cache
from django.core.mail.backends.base import BaseEmailBackend
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from ticketing.fabriques import creer_organisation, creer_utilisateur, en_tete_auth
from ticketing.jetons import empreinte
from ticketing.models import JetonApi, Membre, Utilisateur

from . import emails

MOT_DE_PASSE = 'motdepasse-solide-91'
HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])   # tests plus rapides
DONNEES = {'username': 'lea_m', 'email': 'lea@test.fr', 'password': MOT_DE_PASSE, 'acceptTerms': True}


class MessagerieEnPanne(BaseEmailBackend):
    def send_messages(self, messages):
        raise ConnectionError('serveur de messagerie injoignable')


def poster(client, nom_url, donnees=None, **extra):
    return client.post(reverse(nom_url), donnees if donnees is not None else {}, content_type='application/json', **extra)


@HACHAGE_RAPIDE
class ApiCompteTestCase(TestCase):
    def setUp(self):
        cache.clear()

    def inscrire(self, **changements):
        return poster(self.client, 'api_inscription', {**DONNEES, **changements})

    def connecter(self, nom='anna', mot_de_passe=MOT_DE_PASSE):
        return poster(self.client, 'api_connexion', {'username': nom, 'password': mot_de_passe})


# ======================================================================================
# Inscription
# ======================================================================================
class InscriptionApiTests(ApiCompteTestCase):
    def test_inscription_reussie_donne_un_jeton_et_envoie_le_lien_de_verification(self):
        reponse = self.inscrire()
        self.assertEqual(reponse.status_code, 201)
        corps = reponse.json()
        self.assertEqual(corps['user'], {
            'id': str(Utilisateur.objects.get().pk), 'name': 'lea_m', 'username': 'lea_m', 'email': 'lea@test.fr',
            'role': 'buyer', 'emailVerified': False, 'collectives': []})
        utilisateur = Utilisateur.objects.get()
        self.assertFalse(utilisateur.email_verifie)
        self.assertIsNotNone(utilisateur.cgv_acceptees_le)
        self.assertFalse(utilisateur.accepte_newsletter)
        # le jeton reçu ouvre bien le compte
        moi = self.client.get(reverse('api_moi'), headers={'Authorization': f"Bearer {corps['token']}"})
        self.assertEqual((moi.status_code, moi.json()['username']), (200, 'lea_m'))
        # un e-mail de vérification part, avec un lien vers l'APPLICATION
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['lea@test.fr'])
        self.assertRegex(mail.outbox[0].body, r'http://localhost:8081/verify-email/\S+')

    def test_seule_l_empreinte_du_jeton_est_enregistree(self):
        jeton = self.inscrire().json()['token']
        enregistre = JetonApi.objects.get()
        self.assertNotEqual(enregistre.empreinte, jeton)
        self.assertEqual(enregistre.empreinte, empreinte(jeton))
        self.assertEqual(len(enregistre.empreinte), 64)

    def test_les_options_facultatives(self):
        self.inscrire(newsletter=True, username='  Lea_M  ')
        utilisateur = Utilisateur.objects.get()
        self.assertTrue(utilisateur.accepte_newsletter)
        self.assertEqual(utilisateur.username, 'Lea_M')   # espaces retirés, casse conservée

    def test_champs_vides_donnent_une_erreur_par_champ(self):
        reponse = poster(self.client, 'api_inscription', {})
        self.assertEqual(reponse.status_code, 400)
        corps = reponse.json()
        self.assertEqual(corps['error'], 'validation')
        self.assertEqual(set(corps['fields']), {'username', 'email', 'password', 'acceptTerms'})
        self.assertFalse(Utilisateur.objects.exists())

    def test_nom_d_utilisateur_invalide(self):
        for nom, attendu in [('ab', 'au moins 3'), ('a' * 31, '30 caractères'), ('avec espace', 'sans espace'), ('arobase@x', 'sans espace')]:
            with self.subTest(nom=nom):
                reponse = self.inscrire(username=nom)
                self.assertEqual(reponse.status_code, 400)
                self.assertIn(attendu, reponse.json()['fields']['username'])

    def test_nom_et_adresse_deja_pris_sans_tenir_compte_de_la_casse(self):
        creer_utilisateur('anna@test.fr', MOT_DE_PASSE, nom_utilisateur='Anna_B')
        self.assertIn('déjà pris', self.inscrire(username='anna_b').json()['fields']['username'])
        self.assertIn('existe déjà', self.inscrire(email='ANNA@test.fr').json()['fields']['email'])
        self.assertEqual(Utilisateur.objects.count(), 1)

    def test_adresse_invalide(self):
        self.assertIn('email', self.inscrire(email='pas-un-mail').json()['fields'])

    def test_les_criteres_de_mot_de_passe_sont_ceux_de_django(self):
        for mdp in ['court1', '1234567890', 'lea_m123']:   # trop court, que des chiffres, trop proche du nom d'utilisateur
            with self.subTest(mot_de_passe=mdp):
                reponse = self.inscrire(password=mdp)
                self.assertEqual(reponse.status_code, 400)
                self.assertIn('password', reponse.json()['fields'])

    def test_les_conditions_doivent_etre_acceptees(self):
        for valeur in (False, None, 'true', 1):
            with self.subTest(valeur=valeur):
                self.assertIn('acceptTerms', self.inscrire(acceptTerms=valeur).json()['fields'])

    def test_corps_illisible(self):
        reponse = self.client.post(reverse('api_inscription'), 'pas du json', content_type='application/json')
        self.assertEqual((reponse.status_code, reponse.json()['error']), (400, 'invalid_json'))
        reponse = self.client.post(reverse('api_inscription'), '[1, 2]', content_type='application/json')
        self.assertEqual(reponse.json()['error'], 'invalid_json')

    @override_settings(EMAIL_BACKEND='compte.tests.MessagerieEnPanne')
    def test_une_messagerie_en_panne_ne_fait_pas_echouer_l_inscription(self):
        with self.assertLogs('compte.api', level='ERROR'):
            reponse = self.inscrire()
        self.assertEqual(reponse.status_code, 201)
        self.assertTrue(Utilisateur.objects.filter(username='lea_m').exists())   # le compte existe : un nouveau lien peut être demandé

    @override_settings(DEMANDES_COMPTE_MAX=2)
    def test_plafond_d_inscriptions_par_adresse_ip(self):
        self.assertEqual(self.inscrire(username='un_a', email='a@test.fr').status_code, 201)
        self.assertEqual(self.inscrire(username='deux_b', email='b@test.fr').status_code, 201)
        reponse = self.inscrire(username='trois_c', email='c@test.fr')
        self.assertEqual((reponse.status_code, reponse.json()['error']), (429, 'too_many_attempts'))
        self.assertFalse(Utilisateur.objects.filter(username='trois_c').exists())

    def test_seule_la_methode_post_est_acceptee(self):
        self.assertEqual(self.client.get(reverse('api_inscription')).status_code, 405)


# ======================================================================================
# Connexion et jeton
# ======================================================================================
class ConnexionApiTests(ApiCompteTestCase):
    def setUp(self):
        super().setUp()
        self.anna = creer_utilisateur('anna@test.fr', MOT_DE_PASSE, nom_utilisateur='Anna_B', email_verifie=True)

    def test_connexion_sans_tenir_compte_de_la_casse(self):
        for saisie in ('Anna_B', 'anna_b', '  ANNA_B  '):
            with self.subTest(saisie=saisie):
                reponse = self.connecter(saisie)
                self.assertEqual(reponse.status_code, 200)
                self.assertEqual(reponse.json()['user']['username'], 'Anna_B')

    def test_l_adresse_e_mail_ne_sert_pas_d_identifiant(self):
        self.assertEqual(self.connecter('anna@test.fr').status_code, 401)

    def test_mauvais_mot_de_passe_et_compte_inconnu_donnent_la_meme_reponse(self):
        mauvais = self.connecter('Anna_B', 'faux')
        inconnu = self.connecter('personne', 'faux')
        self.assertEqual((mauvais.status_code, inconnu.status_code), (401, 401))
        self.assertEqual(mauvais.json(), inconnu.json())
        self.assertEqual(mauvais.json()['error'], 'invalid_credentials')

    def test_champs_manquants(self):
        corps = poster(self.client, 'api_connexion', {}).json()
        self.assertEqual(set(corps['fields']), {'username', 'password'})

    def test_compte_desactive(self):
        Utilisateur.objects.filter(pk=self.anna.pk).update(is_active=False)
        self.assertEqual(self.connecter('Anna_B').status_code, 401)

    @override_settings(CONNEXION_TENTATIVES_MAX=3)
    def test_blocage_apres_trop_d_echecs_meme_avec_le_bon_mot_de_passe(self):
        for _ in range(3):
            self.assertEqual(self.connecter('Anna_B', 'faux').status_code, 401)
        reponse = self.connecter('Anna_B')   # bon mot de passe, mais bloqué
        self.assertEqual((reponse.status_code, reponse.json()['error']), (429, 'too_many_attempts'))
        self.assertGreaterEqual(reponse.json()['retryAfterMinutes'], 1)
        self.assertEqual(self.connecter('personne-d-autre', 'faux').status_code, 401)   # un autre nom n'est pas bloqué

    @override_settings(CONNEXION_TENTATIVES_MAX=3)
    def test_une_connexion_reussie_remet_le_compteur_a_zero(self):
        for _ in range(2):
            self.connecter('Anna_B', 'faux')
        self.assertEqual(self.connecter('Anna_B').status_code, 200)
        for _ in range(2):
            self.connecter('Anna_B', 'faux')
        self.assertEqual(self.connecter('Anna_B').status_code, 200)   # 2 échecs seulement depuis la remise à zéro : pas de blocage

    def test_chaque_connexion_cree_son_propre_jeton(self):
        premier, second = self.connecter('Anna_B').json()['token'], self.connecter('Anna_B').json()['token']
        self.assertNotEqual(premier, second)
        self.assertEqual(JetonApi.objects.filter(utilisateur=self.anna).count(), 2)

    def test_deconnexion_ne_coupe_que_cet_appareil(self):
        telephone, ordinateur = self.connecter('Anna_B').json()['token'], self.connecter('Anna_B').json()['token']
        reponse = self.client.post(reverse('api_deconnexion'), headers={'Authorization': f'Bearer {telephone}'})
        self.assertEqual(reponse.status_code, 204)
        self.assertEqual(self.client.get(reverse('api_moi'), headers={'Authorization': f'Bearer {telephone}'}).status_code, 401)
        self.assertEqual(self.client.get(reverse('api_moi'), headers={'Authorization': f'Bearer {ordinateur}'}).status_code, 200)

    def test_deconnexion_sans_jeton(self):
        self.assertEqual(self.client.post(reverse('api_deconnexion')).status_code, 401)


class JetonTests(ApiCompteTestCase):
    def setUp(self):
        super().setUp()
        self.anna = creer_utilisateur('anna@test.fr', MOT_DE_PASSE)

    def moi(self, en_tete):
        return self.client.get(reverse('api_moi'), headers=en_tete)

    def test_sans_jeton_ou_avec_un_jeton_inconnu(self):
        for en_tete in ({}, {'Authorization': 'Bearer inconnu'}, {'Authorization': 'Bearer '}, {'Authorization': 'Basic abc'},
                        {'Authorization': 'abc'}):
            with self.subTest(en_tete=en_tete):
                reponse = self.moi(en_tete)
                self.assertEqual(reponse.status_code, 401)
                self.assertEqual(reponse.json()['error'], 'unauthorized')
                self.assertEqual(reponse['WWW-Authenticate'], 'Bearer')

    def test_le_mot_bearer_n_est_pas_sensible_a_la_casse(self):
        jeton = en_tete_auth(self.anna)['Authorization'].split()[1]
        self.assertEqual(self.moi({'Authorization': f'bearer {jeton}'}).status_code, 200)

    def test_jeton_expire(self):
        en_tete = en_tete_auth(self.anna)
        JetonApi.objects.update(expire_le=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.moi(en_tete).status_code, 401)

    def test_compte_desactive_apres_la_connexion(self):
        en_tete = en_tete_auth(self.anna)
        Utilisateur.objects.filter(pk=self.anna.pk).update(is_active=False)
        self.assertEqual(self.moi(en_tete).status_code, 401)

    def test_la_date_de_derniere_utilisation_est_mise_a_jour(self):
        en_tete = en_tete_auth(self.anna)
        self.assertIsNone(JetonApi.objects.get().derniere_utilisation)
        self.moi(en_tete)
        self.assertIsNotNone(JetonApi.objects.get().derniere_utilisation)

    @override_settings(JETON_DUREE_JOURS=7)
    def test_la_duree_de_vie_vient_de_la_configuration(self):
        en_tete_auth(self.anna)
        reste = JetonApi.objects.get().expire_le - timezone.now()
        self.assertTrue(timedelta(days=6, hours=23) < reste <= timedelta(days=7))

    def test_pas_de_cookie_de_session_ni_besoin_de_csrf(self):
        """L'API s'identifie par jeton : jamais de cookie, donc rien à protéger par CSRF."""
        from django.test import Client
        client = Client(enforce_csrf_checks=True)
        reponse = client.post(reverse('api_connexion'), {'username': 'anna', 'password': MOT_DE_PASSE}, content_type='application/json')
        self.assertEqual(reponse.status_code, 200)
        self.assertEqual(len(reponse.cookies), 0)


# ======================================================================================
# Profil : le rôle vient des appartenances à un collectif
# ======================================================================================
class MoiApiTests(ApiCompteTestCase):
    def test_un_acheteur(self):
        anna = creer_utilisateur('anna@test.fr', MOT_DE_PASSE, nom_utilisateur='anna', first_name='Anna', email_verifie=True)
        corps = self.client.get(reverse('api_moi'), headers=en_tete_auth(anna)).json()
        self.assertEqual((corps['name'], corps['role'], corps['emailVerified'], corps['collectives']), ('Anna', 'buyer', True, []))
        self.assertNotIn('collectiveId', corps)

    def test_un_organisateur(self):
        orga = creer_organisation('Collectif A')
        divine = creer_utilisateur('divine@test.fr', MOT_DE_PASSE)
        Membre.objects.create(utilisateur=divine, organisation=orga, role=Membre.GESTIONNAIRE)
        corps = self.client.get(reverse('api_moi'), headers=en_tete_auth(divine)).json()
        self.assertEqual((corps['role'], corps['collectiveId']), ('organizer', str(orga.pk)))
        self.assertEqual(corps['collectives'], [{'id': str(orga.pk), 'name': 'Collectif A', 'role': 'manager'}])

    def test_un_controleur_seul_reste_acheteur_et_un_collectif_inactif_ne_compte_pas(self):
        orga, inactive = creer_organisation('Collectif A'), creer_organisation('Collectif Z')
        type(inactive).objects.filter(pk=inactive.pk).update(actif=False)
        personne = creer_utilisateur('p@test.fr', MOT_DE_PASSE)
        Membre.objects.create(utilisateur=personne, organisation=orga, role=Membre.CONTROLEUR)
        Membre.objects.create(utilisateur=personne, organisation=inactive, role=Membre.ADMIN)
        corps = self.client.get(reverse('api_moi'), headers=en_tete_auth(personne)).json()
        self.assertEqual((corps['role'], corps['collectives']), ('buyer', []))

    def test_les_collectifs_sont_listes_dans_un_ordre_stable(self):
        a, b = creer_organisation('Bravo'), creer_organisation('Alpha')
        personne = creer_utilisateur('p@test.fr', MOT_DE_PASSE)
        for orga in (a, b):
            Membre.objects.create(utilisateur=personne, organisation=orga, role=Membre.ADMIN)
        corps = self.client.get(reverse('api_moi'), headers=en_tete_auth(personne)).json()
        self.assertEqual([c['name'] for c in corps['collectives']], ['Alpha', 'Bravo'])
        self.assertEqual(corps['collectiveId'], str(b.pk))   # le premier par ordre alphabétique


# ======================================================================================
# Vérification de l'adresse e-mail
# ======================================================================================
class VerificationEmailApiTests(ApiCompteTestCase):
    def setUp(self):
        super().setUp()
        self.anna = creer_utilisateur('anna@test.fr', MOT_DE_PASSE)

    def verifier(self, jeton):
        return poster(self.client, 'api_verifier_email', {'token': jeton})

    def test_un_lien_valide_verifie_l_adresse(self):
        reponse = self.verifier(emails.fabriquer_jeton(self.anna))
        self.assertEqual((reponse.status_code, reponse.json()), (200, {'verified': True}))
        self.anna.refresh_from_db()
        self.assertTrue(self.anna.email_verifie)

    def test_rejouer_le_lien_ne_change_rien(self):
        jeton = emails.fabriquer_jeton(self.anna)
        self.assertEqual(self.verifier(jeton).status_code, 200)
        self.assertEqual(self.verifier(jeton).status_code, 200)

    def test_aucune_connexion_n_est_necessaire(self):
        """Le lien s'ouvre souvent dans un autre navigateur que celui où l'on est connecté."""
        self.assertEqual(self.verifier(emails.fabriquer_jeton(self.anna)).status_code, 200)

    def test_liens_invalides(self):
        for jeton in ('', 'n-importe-quoi', emails.fabriquer_jeton(self.anna)[:-3] + 'xyz', 12345, None):
            with self.subTest(jeton=jeton):
                reponse = self.verifier(jeton)
                self.assertEqual((reponse.status_code, reponse.json()['error']), (400, 'invalid_link'))
        self.anna.refresh_from_db()
        self.assertFalse(self.anna.email_verifie)

    def test_lien_expire(self):
        jeton = emails.fabriquer_jeton(self.anna)
        with mock.patch.object(emails.signing, 'loads', side_effect=signing.SignatureExpired('trop vieux')):
            self.assertEqual(self.verifier(jeton).status_code, 400)

    def test_un_lien_pour_l_ancienne_adresse_ne_marche_plus(self):
        jeton = emails.fabriquer_jeton(self.anna)
        Utilisateur.objects.filter(pk=self.anna.pk).update(email='nouvelle@test.fr')
        self.assertEqual(self.verifier(jeton).status_code, 400)

    def test_un_lien_ne_verifie_que_son_propre_compte(self):
        autre = creer_utilisateur('autre@test.fr', MOT_DE_PASSE)
        self.verifier(emails.fabriquer_jeton(self.anna))
        autre.refresh_from_db()
        self.assertFalse(autre.email_verifie)

    def test_renvoi_du_lien_avec_limite(self):
        en_tete = en_tete_auth(self.anna)
        self.assertEqual(self.client.post(reverse('api_renvoyer_verification'), headers=en_tete).status_code, 204)
        self.assertEqual(len(mail.outbox), 1)
        reponse = self.client.post(reverse('api_renvoyer_verification'), headers=en_tete)
        self.assertEqual((reponse.status_code, reponse.json()['error']), (429, 'too_many_requests'))
        self.assertEqual(len(mail.outbox), 1)

    def test_pas_de_renvoi_quand_l_adresse_est_deja_verifiee(self):
        Utilisateur.objects.filter(pk=self.anna.pk).update(email_verifie=True)
        self.assertEqual(self.client.post(reverse('api_renvoyer_verification'), headers=en_tete_auth(self.anna)).status_code, 204)
        self.assertEqual(len(mail.outbox), 0)

    def test_renvoi_reserve_aux_comptes_connectes(self):
        self.assertEqual(self.client.post(reverse('api_renvoyer_verification')).status_code, 401)


# ======================================================================================
# Mot de passe oublié
# ======================================================================================
class MotDePasseOublieApiTests(ApiCompteTestCase):
    def setUp(self):
        super().setUp()
        self.anna = creer_utilisateur('anna@test.fr', MOT_DE_PASSE, nom_utilisateur='Anna_B')

    def demander(self, email):
        return poster(self.client, 'api_mdp_oublie', {'email': email})

    def lien(self):
        trouve = re.search(r'/reset-password/(?P<uid>[^/\s]+)/(?P<token>[^/\s]+)', mail.outbox[-1].body)
        return trouve.group('uid'), trouve.group('token')

    def confirmer(self, uid, jeton, mot_de_passe='nouveau-mot-de-passe-77'):
        return poster(self.client, 'api_mdp_nouveau', {'uid': uid, 'token': jeton, 'password': mot_de_passe})

    def test_adresse_connue_et_inconnue_donnent_la_meme_reponse(self):
        connue, inconnue = self.demander('anna@test.fr'), self.demander('personne@test.fr')
        self.assertEqual((connue.status_code, inconnue.status_code), (204, 204))
        self.assertEqual(connue.content, inconnue.content)
        self.assertEqual(len(mail.outbox), 1)   # seule l'adresse connue reçoit un message

    def test_l_e_mail_contient_un_lien_vers_l_application_et_le_nom_d_utilisateur(self):
        self.demander('ANNA@test.fr')   # la casse n'a pas d'importance
        self.assertEqual(mail.outbox[0].to, ['anna@test.fr'])
        self.assertIn('http://localhost:8081/reset-password/', mail.outbox[0].body)
        self.assertIn('Anna_B', mail.outbox[0].body)

    def test_un_compte_desactive_ne_recoit_rien(self):
        Utilisateur.objects.filter(pk=self.anna.pk).update(is_active=False)
        self.assertEqual(self.demander('anna@test.fr').status_code, 204)
        self.assertEqual(len(mail.outbox), 0)

    def test_adresse_mal_formee(self):
        reponse = self.demander('pas-un-mail')
        self.assertEqual((reponse.status_code, reponse.json()['error']), (400, 'validation'))

    @override_settings(DEMANDES_COMPTE_MAX=2)
    def test_plafond_de_demandes_pour_une_meme_adresse(self):
        self.assertEqual(self.demander('anna@test.fr').status_code, 204)
        self.assertEqual(self.demander('anna@test.fr').status_code, 204)
        reponse = self.demander('anna@test.fr')
        self.assertEqual((reponse.status_code, reponse.json()['error']), (429, 'too_many_attempts'))
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.demander('autre@test.fr').status_code, 204)   # une autre adresse n'est pas bloquée

    def test_nouveau_mot_de_passe_change_le_mot_de_passe_verifie_l_adresse_et_deconnecte_les_appareils(self):
        ancien_jeton = en_tete_auth(self.anna)
        self.demander('anna@test.fr')
        uid, jeton = self.lien()
        self.assertEqual(self.confirmer(uid, jeton).status_code, 204)
        self.anna.refresh_from_db()
        self.assertTrue(self.anna.check_password('nouveau-mot-de-passe-77'))
        self.assertTrue(self.anna.email_verifie)   # avoir reçu le lien prouve que l'adresse est la bonne
        self.assertEqual(self.client.get(reverse('api_moi'), headers=ancien_jeton).status_code, 401)
        self.assertEqual(self.connecter('Anna_B', 'nouveau-mot-de-passe-77').status_code, 200)
        self.assertEqual(self.connecter('Anna_B').status_code, 401)

    def test_un_lien_ne_sert_qu_une_fois(self):
        self.demander('anna@test.fr')
        uid, jeton = self.lien()
        self.assertEqual(self.confirmer(uid, jeton).status_code, 204)
        reponse = self.confirmer(uid, jeton, 'encore-un-autre-mdp-55')
        self.assertEqual((reponse.status_code, reponse.json()['error']), (400, 'invalid_link'))

    def test_liens_invalides(self):
        self.demander('anna@test.fr')
        uid, jeton = self.lien()
        for variante in [(uid, jeton[:-3] + 'xyz'), ('zzz', jeton), ('', ''), (uid, ''), ('!!!', 'abc')]:
            with self.subTest(variante=variante):
                reponse = self.confirmer(*variante)
                self.assertEqual((reponse.status_code, reponse.json()['error']), (400, 'invalid_link'))

    def test_mot_de_passe_refuse_par_les_criteres_de_django(self):
        self.demander('anna@test.fr')
        uid, jeton = self.lien()
        for mdp in ('court', '1234567890', ''):
            with self.subTest(mot_de_passe=mdp):
                reponse = self.confirmer(uid, jeton, mdp)
                self.assertEqual(reponse.status_code, 400)
                self.assertIn('password', reponse.json()['fields'])
        self.anna.refresh_from_db()
        self.assertTrue(self.anna.check_password(MOT_DE_PASSE))   # inchangé

    def test_lien_d_un_compte_desactive(self):
        self.demander('anna@test.fr')
        uid, jeton = self.lien()
        Utilisateur.objects.filter(pk=self.anna.pk).update(is_active=False)
        self.assertEqual(self.confirmer(uid, jeton).status_code, 400)
