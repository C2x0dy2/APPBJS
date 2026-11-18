"""
Tests. Chaque test crée ses propres données avec les fabriques ci-dessous :
aucune donnée n'est écrite dans le code de l'application.
"""
import threading
from datetime import time, timedelta
from io import StringIO

from django.contrib import admin
from django.contrib.auth import authenticate, get_user_model
from django.core.management import call_command
from django.db import IntegrityError, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from . import services
from .fabriques import creer_evenement, creer_organisation, creer_utilisateur
from .models import Billet, Categorie, Commande, Evenement, Lieu, Membre, ParametresSite, Tarif, TypePlace

# Hachage rapide : seulement dans les tests, pour ne pas ralentir les créations d'utilisateurs.
HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


# ======================================================================================
# Utilisateurs
# ======================================================================================
@HACHAGE_RAPIDE
class UtilisateurTests(TestCase):
    def test_connexion_par_nom_utilisateur_sans_tenir_compte_de_la_casse(self):
        creer_utilisateur('ana@test.fr', nom_utilisateur='Ana_B')
        for saisie in ['Ana_B', 'ana_b', 'ANA_B']:
            with self.subTest(saisie=saisie):
                self.assertIsNotNone(authenticate(username=saisie, password='motdepasse-test-123'))
        self.assertIsNone(authenticate(username='Ana_B', password='mauvais'))

    def test_l_email_ne_sert_plus_d_identifiant(self):
        creer_utilisateur('ana@test.fr', nom_utilisateur='ana_b')
        self.assertIsNone(authenticate(username='ana@test.fr', password='motdepasse-test-123'))

    def test_nom_utilisateur_unique_sans_tenir_compte_de_la_casse(self):
        creer_utilisateur('un@test.fr', nom_utilisateur='Fosse_Fan')
        with self.assertRaises(IntegrityError):
            creer_utilisateur('deux@test.fr', nom_utilisateur='fosse_fan')

    def test_nom_utilisateur_et_email_obligatoires(self):
        with self.assertRaises(ValueError):
            get_user_model().objects.create_user(username='', email='a@test.fr', password='x' * 12)
        with self.assertRaises(ValueError):
            get_user_model().objects.create_user(username='anna', email='', password='x' * 12)

    def test_validation_du_nom_d_utilisateur(self):
        from django.core.exceptions import ValidationError
        for refuse in ['ab', 'avec espace', 'arobase@ici', 'plus+signe', 'x' * 31]:
            with self.subTest(nom=refuse):
                utilisateur = get_user_model()(username=refuse, email='v@test.fr')
                with self.assertRaises(ValidationError) as contexte:
                    utilisateur.full_clean(exclude=['password'])
                self.assertIn('username', contexte.exception.message_dict)
        for i, accepte in enumerate(['Anna_92', 'anna.b', 'jean-luc', 'Éloïse']):
            with self.subTest(nom=accepte):
                get_user_model()(username=accepte, email=f'v{i}@test.fr').full_clean(exclude=['password'])

    def test_email_unique(self):
        creer_utilisateur('ana@test.fr')
        with self.assertRaises(IntegrityError):
            creer_utilisateur('ana@test.fr', nom_utilisateur='autre_nom')

    def test_email_unique_sans_tenir_compte_de_la_casse(self):
        creer_utilisateur('ana@test.fr')
        with self.assertRaises(IntegrityError):
            creer_utilisateur('ANA@test.fr', nom_utilisateur='autre_nom')

    def test_fuseau_par_defaut_et_superuser(self):
        u = get_user_model().objects.create_superuser(username='chef', email='chef@test.fr', password='motdepasse-test-123')
        self.assertEqual(u.fuseau_horaire, 'Europe/Paris')
        self.assertTrue(u.is_staff and u.is_superuser)

    def test_un_seul_role_par_utilisateur_et_organisation(self):
        u, o = creer_utilisateur(), creer_organisation()
        Membre.objects.create(utilisateur=u, organisation=o, role=Membre.ADMIN)
        with self.assertRaises(IntegrityError):
            Membre.objects.create(utilisateur=u, organisation=o, role=Membre.CONTROLEUR)


# ======================================================================================
# Moteur de réservation
# ======================================================================================
class ReservationTests(TestCase):
    def test_jamais_plus_que_la_capacite(self):
        ev, tp = creer_evenement(capacite=3)
        services.reserver(ev, 'a@x.fr', [(tp.id, 2)])
        with self.assertRaises(services.PlusDePlaces):
            services.reserver(ev, 'b@x.fr', [(tp.id, 2)])
        tp.refresh_from_db()
        self.assertEqual((tp.retenues, tp.disponibles), (2, 1))

    def test_commande_multi_types_tout_ou_rien(self):
        ev, balcon = creer_evenement(capacite=5)
        fosse = TypePlace.objects.create(evenement=ev, nom='Fosse', capacite=1, prix_base_centimes=1000)
        with self.assertRaises(services.PlusDePlaces):
            services.reserver(ev, 'a@x.fr', [(balcon.id, 2), (fosse.id, 2)])
        balcon.refresh_from_db()
        self.assertEqual(balcon.retenues, 0)

    def test_tarif_early_jusqua_la_date_puis_prix_fige(self):
        ev, tp = creer_evenement(prix=3000)
        maintenant = timezone.now()
        Tarif.objects.create(type_place=tp, prix_centimes=2000, valide_jusqua=maintenant + timedelta(hours=1))
        tot = services.reserver(ev, 'a@x.fr', [(tp.id, 1)], maintenant=maintenant)
        tard = services.reserver(ev, 'b@x.fr', [(tp.id, 1)], maintenant=maintenant + timedelta(hours=2))
        self.assertEqual((tot.total_centimes, tard.total_centimes), (2000, 3000))


class ExpirationTests(TestCase):
    def test_retenue_expiree_libere_les_places_une_seule_fois(self):
        ev, tp = creer_evenement(capacite=2)
        maintenant = timezone.now()
        services.reserver(ev, 'a@x.fr', [(tp.id, 2)], maintenant=maintenant)
        self.assertEqual(services.liberer_retenues_expirees(maintenant + timedelta(minutes=5)), 0)
        self.assertEqual(services.liberer_retenues_expirees(maintenant + timedelta(minutes=16)), 1)
        self.assertEqual(services.liberer_retenues_expirees(maintenant + timedelta(minutes=17)), 0)
        tp.refresh_from_db()
        self.assertEqual(tp.disponibles, 2)

    def test_virement_retient_plus_longtemps_que_carte(self):
        ev, tp = creer_evenement()
        maintenant = timezone.now()
        carte = services.reserver(ev, 'a@x.fr', [(tp.id, 1)], 'carte', maintenant=maintenant)
        virement = services.reserver(ev, 'b@x.fr', [(tp.id, 1)], 'virement', maintenant=maintenant)
        self.assertGreater(virement.expire_le, carte.expire_le + timedelta(hours=24))

    @override_settings(DUREES_RETENUE_MINUTES={'carte': 3, 'virement': 60})
    def test_duree_de_retenue_vient_de_la_configuration(self):
        ev, tp = creer_evenement()
        maintenant = timezone.now()
        commande = services.reserver(ev, 'a@x.fr', [(tp.id, 1)], 'carte', maintenant=maintenant)
        self.assertEqual(commande.expire_le, maintenant + timedelta(minutes=3))


class PaiementTests(TestCase):
    def test_notification_en_double_cree_un_seul_billet(self):
        ev, tp = creer_evenement()
        commande = services.reserver(ev, 'a@x.fr', [(tp.id, 1)])
        self.assertEqual(services.confirmer_paiement('evt_1', commande.id, 2000), 'paid')
        self.assertEqual(services.confirmer_paiement('evt_1', commande.id, 2000), 'duplicate')
        self.assertEqual(services.confirmer_paiement('evt_2', commande.id, 2000), 'duplicate')
        self.assertEqual(Billet.objects.filter(commande=commande).count(), 1)
        tp.refresh_from_db()
        self.assertEqual((tp.vendues, tp.retenues), (1, 0))

    def test_paiement_tardif_reprend_les_places_si_libres(self):
        ev, tp = creer_evenement(capacite=1)
        maintenant = timezone.now()
        commande = services.reserver(ev, 'a@x.fr', [(tp.id, 1)], maintenant=maintenant)
        services.liberer_retenues_expirees(maintenant + timedelta(hours=1))
        self.assertEqual(services.confirmer_paiement('evt_1', commande.id, 2000), 'paid')

    def test_paiement_tardif_a_rembourser_si_complet(self):
        ev, tp = creer_evenement(capacite=1)
        maintenant = timezone.now()
        lente = services.reserver(ev, 'a@x.fr', [(tp.id, 1)], maintenant=maintenant)
        services.liberer_retenues_expirees(maintenant + timedelta(hours=1))
        services.reserver(ev, 'b@x.fr', [(tp.id, 1)])
        self.assertEqual(services.confirmer_paiement('evt_1', lente.id, 2000), 'late')
        lente.refresh_from_db()
        self.assertTrue(lente.a_rembourser)
        self.assertEqual(Billet.objects.count(), 0)


class EntreeTests(TestCase):
    def test_billet_valide_une_seule_fois(self):
        ev, tp = creer_evenement()
        commande = services.reserver(ev, 'a@x.fr', [(tp.id, 1)])
        services.confirmer_paiement('evt_1', commande.id, 2000)
        code = Billet.objects.get().code
        self.assertEqual(services.valider_entree(code), 'ok')
        self.assertEqual(services.valider_entree(code), 'already_used')
        self.assertEqual(services.valider_entree('inconnu'), 'invalid')


class ConcurrenceTests(TransactionTestCase):
    def test_acheteurs_simultanes_ne_surventent_jamais(self):
        ev, tp = creer_evenement(capacite=10)
        resultats, barriere = [], threading.Barrier(30)

        def acheter(i):
            barriere.wait()
            try:
                services.reserver(ev, f'{i}@x.fr', [(tp.id, 1)])
                resultats.append('ok')
            except services.PlusDePlaces:
                resultats.append('complet')
            except Exception as e:   # ex. « database is locked » sous SQLite
                resultats.append(f'erreur:{type(e).__name__}')
            finally:
                connection.close()

        fils = [threading.Thread(target=acheter, args=(i,)) for i in range(30)]
        [f.start() for f in fils]
        [f.join() for f in fils]
        tp.refresh_from_db()
        self.assertLessEqual(tp.retenues, 10)
        self.assertEqual(resultats.count('ok'), tp.retenues)
        self.assertEqual(Commande.objects.count(), resultats.count('ok'))


# ======================================================================================
# Admin et commande d'initialisation
# ======================================================================================
@HACHAGE_RAPIDE
class AdminTests(TestCase):
    def setUp(self):
        self.client.force_login(get_user_model().objects.create_superuser(username='chef', email='chef@test.fr', password='x' * 12))

    def test_toutes_les_listes_de_l_admin_s_affichent(self):
        for modele in admin.site._registry:
            url = reverse(f'admin:{modele._meta.app_label}_{modele._meta.model_name}_changelist')
            with self.subTest(modele=modele.__name__):
                self.assertIn(self.client.get(url).status_code, (200, 302))   # 302 : la fiche unique des paramètres

    def test_fiches_d_ajout_des_modeles_saisissables(self):
        for nom in ['evenement', 'categorie', 'lieu', 'organisation', 'utilisateur']:
            with self.subTest(nom=nom):
                self.assertEqual(self.client.get(reverse(f'admin:ticketing_{nom}_add')).status_code, 200)

    def test_evenement_se_cree_avec_ses_types_de_place_dans_la_meme_fiche(self):
        organisation = creer_organisation()
        fiche = reverse('admin:ticketing_evenement_add')
        r = self.client.post(fiche, {
            'organisation': organisation.pk, 'titre': 'Saisi en admin', 'slug': 'saisi-en-admin', 'debut_0': '2030-01-01',
            'debut_1': '20:00:00', 'fuseau_horaire': 'Europe/Paris', 'publie': 'on',
            'ouverture_portes': '19:30:00', 'devise': 'xof',   # ce que saisit l'administrateur : la monnaie est normalisée à l'enregistrement
            'types_place-TOTAL_FORMS': '2', 'types_place-INITIAL_FORMS': '0', 'types_place-MIN_NUM_FORMS': '0',
            'types_place-MAX_NUM_FORMS': '1000',
            'galerie-TOTAL_FORMS': '0', 'galerie-INITIAL_FORMS': '0', 'galerie-MIN_NUM_FORMS': '0', 'galerie-MAX_NUM_FORMS': '1000',   # galerie vide
            'types_place-0-nom': 'Fosse', 'types_place-0-capacite': '100', 'types_place-0-prix_base_centimes': '2500',
            'types_place-1-nom': 'Balcon', 'types_place-1-capacite': '50', 'types_place-1-prix_base_centimes': '1800',
        })
        self.assertEqual(r.status_code, 302, getattr(r, 'context', None) and r.context['adminform'].form.errors)
        evenement = Evenement.objects.get(slug='saisi-en-admin')
        self.assertEqual(evenement.types_place.count(), 2)
        self.assertEqual((evenement.devise, evenement.ouverture_portes), ('XOF', time(19, 30)))

    def test_la_fiche_d_ajout_propose_la_monnaie_par_defaut_et_l_heure_des_portes(self):
        with override_settings(DEVISE_PAR_DEFAUT='EUR'):
            r = self.client.get(reverse('admin:ticketing_evenement_add'))
        formulaire = r.context['adminform'].form
        self.assertEqual(formulaire['devise'].value(), 'EUR')   # pré-remplie : l'administrateur n'a rien à saisir pour le cas courant
        self.assertIn('ouverture_portes', formulaire.fields)


class InitSiteTests(TestCase):
    def test_cree_la_fiche_vide_sans_doublon_et_sans_contenu(self):
        for _ in range(2):
            call_command('init_site', stdout=StringIO())
        self.assertEqual(ParametresSite.objects.count(), 1)
        fiche = ParametresSite.objects.get()
        self.assertEqual((fiche.nom_site, fiche.hero_titre, fiche.hero_texte, fiche.email_contact), ('', '', '', ''))
        self.assertEqual((Evenement.objects.count(), Categorie.objects.count(), Lieu.objects.count()), (0, 0, 0))

    def test_une_seule_fiche_de_parametres_possible(self):
        ParametresSite.objects.create(nom_site='A')
        ParametresSite.objects.create(nom_site='B')
        self.assertEqual(ParametresSite.objects.count(), 1)
        self.assertEqual(ParametresSite.charger().nom_site, 'B')


class LibererRetenuesCommandeTests(TestCase):
    """La commande à planifier (toutes les minutes) pour que les places d'une réservation abandonnée soient rendues."""

    def lancer(self):
        sortie = StringIO()
        call_command('liberer_retenues', stdout=sortie)
        return sortie.getvalue()

    def test_libere_les_reservations_echues_et_garde_les_autres(self):
        evenement, type_place = creer_evenement(capacite=10)
        echue = services.reserver(evenement, 'a@test.fr', [(type_place.id, 3)], maintenant=timezone.now() - timedelta(hours=1))
        en_cours = services.reserver(evenement, 'b@test.fr', [(type_place.id, 2)])
        self.assertIn('1 réservation(s) expirée(s) libérée(s).', self.lancer())
        self.assertEqual(Commande.objects.get(pk=echue.pk).statut, Commande.EXPIREE)
        self.assertEqual(Commande.objects.get(pk=en_cours.pk).statut, Commande.EN_ATTENTE)
        self.assertEqual(TypePlace.objects.get(pk=type_place.pk).retenues, 2)   # seules les places de la réservation en cours restent bloquées

    def test_relancee_elle_ne_fait_rien_de_plus(self):
        evenement, type_place = creer_evenement(capacite=10)
        services.reserver(evenement, 'a@test.fr', [(type_place.id, 3)], maintenant=timezone.now() - timedelta(hours=1))
        self.lancer()
        self.assertIn('0 réservation(s) expirée(s) libérée(s).', self.lancer())
        self.assertEqual(TypePlace.objects.get(pk=type_place.pk).retenues, 0)   # les places ne sont pas rendues deux fois

    def test_sans_aucune_reservation(self):
        self.assertIn('0 réservation(s) expirée(s) libérée(s).', self.lancer())


class LogoTests(TestCase):
    def test_le_logo_et_l_icone_acceptent_le_svg(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
        fiche = ParametresSite(logo=SimpleUploadedFile('logo.svg', svg, 'image/svg+xml'),
                               favicon=SimpleUploadedFile('icone.svg', svg, 'image/svg+xml'))
        fiche.full_clean()   # ne lève pas d'erreur
        fiche.logo = SimpleUploadedFile('logo.exe', b'x', 'application/octet-stream')
        with self.assertRaises(ValidationError):
            fiche.full_clean()
