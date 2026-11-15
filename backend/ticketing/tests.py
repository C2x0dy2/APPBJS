"""
Tests. Chaque test crée ses propres données avec les fabriques ci-dessous :
aucune donnée n'est écrite dans le code de l'application.
"""
import hashlib
import hmac
import json
import threading
from datetime import timedelta
from io import StringIO

from django.contrib import admin
from django.contrib.auth import authenticate, get_user_model
from django.core.management import call_command
from django.db import IntegrityError, connection
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from . import services
from .fabriques import creer_evenement, creer_organisation, creer_utilisateur, parametres
from .models import (Billet, Categorie, Commande, Evenement, Lieu, Membre, Organisation, ParametresSite,
                     Tarif, TypePlace)

SECRET = 'secret-de-test'

# Hachage rapide : seulement dans les tests, pour ne pas ralentir les créations d'utilisateurs.
HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


# ======================================================================================
# Fabriques
# ======================================================================================
def signer(client, charge):
    corps = json.dumps(charge)
    signature = hmac.new(SECRET.encode(), corps.encode(), hashlib.sha256).hexdigest()
    return client.post(reverse('api_webhook_paiement'), corps, content_type='application/json', HTTP_X_SIGNATURE=signature)


# ======================================================================================
# Utilisateurs
# ======================================================================================
@HACHAGE_RAPIDE
class UtilisateurTests(TestCase):
    def test_connexion_par_email_sans_nom_utilisateur(self):
        creer_utilisateur('Ana@Test.fr')
        self.assertEqual(get_user_model().objects.get().email, 'Ana@test.fr'.lower().replace('ana', 'ana'))
        self.assertIsNotNone(authenticate(email='ana@test.fr', password='motdepasse-test-123'))
        self.assertIsNone(authenticate(email='ana@test.fr', password='mauvais'))

    def test_email_unique(self):
        creer_utilisateur('ana@test.fr')
        with self.assertRaises(IntegrityError):
            creer_utilisateur('ana@test.fr')

    def test_fuseau_par_defaut_et_superuser(self):
        u = get_user_model().objects.create_superuser(email='chef@test.fr', password='motdepasse-test-123')
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
# API
# ======================================================================================
@override_settings(PAYMENT_WEBHOOK_SECRET=SECRET)
@HACHAGE_RAPIDE
class ApiTests(TestCase):
    def setUp(self):
        self.organisation = creer_organisation()
        self.evenement, self.type_place = creer_evenement(self.organisation, capacite=2)

    def reserver(self, quantite=1, email='a@x.fr'):
        return self.client.post(
            reverse('api_reserver', args=[self.evenement.id]),
            json.dumps({'email': email, 'items': [{'ticket_type': self.type_place.id, 'quantity': quantite}]}),
            content_type='application/json')

    def test_liste_donne_places_et_les_deux_heures(self):
        donnees = self.client.get(reverse('api_evenements')).json()['events'][0]
        self.assertEqual(donnees['ticket_types'][0]['available'], 2)
        self.assertIn('starts_at_utc', donnees)
        self.assertIn('starts_at_local', donnees)

    def test_reservation_puis_complet_renvoie_409(self):
        self.assertEqual(self.reserver(2).status_code, 201)
        r = self.reserver(1, 'b@x.fr')
        self.assertEqual((r.status_code, r.json()['error']), (409, 'sold_out'))

    def test_validation_des_reservations(self):
        self.assertEqual(self.reserver(0).status_code, 400)
        self.assertEqual(self.reserver(1, 'pas-un-mail').status_code, 400)

    @override_settings(MAX_PLACES_PAR_COMMANDE=1)
    def test_maximum_par_commande_vient_de_la_configuration(self):
        self.assertEqual(self.reserver(2).status_code, 400)
        self.assertEqual(self.reserver(1).status_code, 201)

    def test_webhook_refuse_mauvaise_signature_et_mauvais_montant(self):
        commande_id = self.reserver().json()['order_id']
        faux = self.client.post(reverse('api_webhook_paiement'), '{}', content_type='application/json', HTTP_X_SIGNATURE='non')
        self.assertEqual(faux.status_code, 401)
        r = signer(self.client, {'event_id': 'e1', 'order_id': commande_id, 'amount_cents': 1})
        self.assertEqual(r.status_code, 400)

    @override_settings(PAYMENT_WEBHOOK_SECRET='')
    def test_webhook_desactive_sans_secret(self):
        r = self.client.post(reverse('api_webhook_paiement'), '{}', content_type='application/json')
        self.assertEqual(r.status_code, 503)

    def test_webhook_deux_fois_un_seul_billet(self):
        commande_id = self.reserver().json()['order_id']
        charge = {'event_id': 'e1', 'order_id': commande_id, 'amount_cents': 2000}
        self.assertEqual(signer(self.client, charge).json()['result'], 'paid')
        self.assertEqual(signer(self.client, charge).json()['result'], 'duplicate')
        self.assertEqual(Billet.objects.count(), 1)


# ======================================================================================
# Espace organisateur : isolation entre organisations et rôles
# ======================================================================================
@HACHAGE_RAPIDE
class AccesOrganisationTests(TestCase):
    """Un membre de l'organisation A ne voit JAMAIS rien de l'organisation B, et inversement."""

    def setUp(self):
        self.orga_a, self.orga_b = creer_organisation('Collectif A'), creer_organisation('Collectif B')
        self.ev_a, self.tp_a = creer_evenement(self.orga_a, titre='Événement du collectif A', prix=1000)
        self.ev_b, self.tp_b = creer_evenement(self.orga_b, titre='Événement du collectif B', prix=2000)
        for ev, tp, email in [(self.ev_a, self.tp_a, 'acheteur-a@test.fr'), (self.ev_b, self.tp_b, 'acheteur-b@test.fr')]:
            commande = services.reserver(ev, email, [(tp.id, 1)])
            services.confirmer_paiement(f'evt-{email}', commande.id, tp.prix_base_centimes)
        self.code_a, self.code_b = Billet.objects.get(type_place=self.tp_a).code, Billet.objects.get(type_place=self.tp_b).code

        self.admin_a = creer_utilisateur('admin-a@test.fr')
        self.gestionnaire_a = creer_utilisateur('gestionnaire-a@test.fr')
        self.controleur_a = creer_utilisateur('controleur-a@test.fr')
        self.admin_b = creer_utilisateur('admin-b@test.fr')
        self.sans_organisation = creer_utilisateur('seul@test.fr')
        self.superuser = get_user_model().objects.create_superuser(email='root@test.fr', password='x' * 12)
        Membre.objects.create(utilisateur=self.admin_a, organisation=self.orga_a, role=Membre.ADMIN)
        Membre.objects.create(utilisateur=self.gestionnaire_a, organisation=self.orga_a, role=Membre.GESTIONNAIRE)
        Membre.objects.create(utilisateur=self.controleur_a, organisation=self.orga_a, role=Membre.CONTROLEUR)
        Membre.objects.create(utilisateur=self.admin_b, organisation=self.orga_b, role=Membre.ADMIN)

    # -- adresses de l'organisation A (et B, pour les croisements)
    def url_tableau(self, orga):
        return reverse('orga_tableau_de_bord', args=[orga.slug])

    def url_evenement(self, orga, ev):
        return reverse('orga_evenement', args=[orga.slug, ev.pk])

    def url_export(self, orga, ev):
        return reverse('orga_export', args=[orga.slug, ev.pk])

    def url_scan(self, orga, ev):
        return reverse('orga_valider_entree', args=[orga.slug, ev.pk])

    def scanner(self, orga, ev, code):
        return self.client.post(self.url_scan(orga, ev), json.dumps({'code': code}), content_type='application/json')

    def pages_gestion_de_a(self):
        return [self.url_tableau(self.orga_a), self.url_evenement(self.orga_a, self.ev_a), self.url_export(self.orga_a, self.ev_a)]

    # -- membres de A : accès normal
    def test_admin_et_gestionnaire_accedent_aux_pages_de_leur_organisation(self):
        for utilisateur in (self.admin_a, self.gestionnaire_a):
            self.client.force_login(utilisateur)
            for url in self.pages_gestion_de_a():
                with self.subTest(utilisateur=utilisateur.email, url=url):
                    self.assertEqual(self.client.get(url).status_code, 200)
            self.assertEqual(self.scanner(self.orga_a, self.ev_a, 'x').status_code, 200)

    def test_le_controleur_ne_voit_que_le_scanner(self):
        self.client.force_login(self.controleur_a)
        for url in self.pages_gestion_de_a():
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.scanner(self.orga_a, self.ev_a, self.code_a).json()['result'], 'ok')

    # -- isolation : un membre de B n'accède à RIEN de A
    def test_membre_de_b_n_accede_a_aucune_page_ni_donnee_de_a(self):
        self.client.force_login(self.admin_b)
        for url in self.pages_gestion_de_a():
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.scanner(self.orga_a, self.ev_a, self.code_a).status_code, 404)
        self.assertEqual(Billet.objects.get(code=self.code_a).statut, Billet.VALIDE)

    def test_et_reciproquement(self):
        self.client.force_login(self.admin_a)
        for url in [self.url_tableau(self.orga_b), self.url_evenement(self.orga_b, self.ev_b), self.url_export(self.orga_b, self.ev_b)]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.scanner(self.orga_b, self.ev_b, self.code_b).status_code, 404)

    def test_identifiant_d_un_evenement_d_une_autre_organisation_donne_404(self):
        """Membre de A, mais l'identifiant demandé est celui d'un événement de B."""
        self.client.force_login(self.admin_a)
        self.assertEqual(self.client.get(self.url_evenement(self.orga_a, self.ev_b)).status_code, 404)
        self.assertEqual(self.client.get(self.url_export(self.orga_a, self.ev_b)).status_code, 404)
        self.assertEqual(self.scanner(self.orga_a, self.ev_b, self.code_b).status_code, 404)
        self.assertEqual(Billet.objects.get(code=self.code_b).statut, Billet.VALIDE)

    def test_aucune_donnee_de_l_autre_organisation_dans_les_reponses(self):
        self.client.force_login(self.admin_a)
        tableau = self.client.get(self.url_tableau(self.orga_a)).content.decode()
        self.assertIn('Événement du collectif A', tableau)
        self.assertNotIn('Événement du collectif B', tableau)
        export = self.client.get(self.url_export(self.orga_a, self.ev_a)).content.decode()
        self.assertIn('acheteur-a@test.fr', export)
        self.assertNotIn('acheteur-b@test.fr', export)
        self.assertNotIn(self.code_b, export)

    def test_un_code_d_un_autre_evenement_est_traite_comme_inconnu(self):
        """Même dans sa propre organisation, un billet d'un autre événement n'est pas validé."""
        autre_ev, autre_tp = creer_evenement(self.orga_a, titre='Autre événement de A')
        commande = services.reserver(autre_ev, 'z@test.fr', [(autre_tp.id, 1)])
        services.confirmer_paiement('evt-z', commande.id, 2000)
        code_autre = Billet.objects.get(type_place=autre_tp).code
        self.client.force_login(self.admin_a)
        self.assertEqual(self.scanner(self.orga_a, self.ev_a, code_autre).json()['result'], 'invalid')
        self.assertEqual(Billet.objects.get(code=code_autre).statut, Billet.VALIDE)

    # -- ce qui ne doit rien révéler
    def test_anonyme_sans_organisation_et_superuser_non_membre_donnent_404(self):
        for utilisateur in (None, self.sans_organisation, self.superuser):
            if utilisateur:
                self.client.force_login(utilisateur)
            for url in self.pages_gestion_de_a():
                with self.subTest(utilisateur=getattr(utilisateur, 'email', 'anonyme'), url=url):
                    self.assertEqual(self.client.get(url).status_code, 404)
            self.assertEqual(self.scanner(self.orga_a, self.ev_a, self.code_a).status_code, 404)

    def test_organisation_inexistante_et_organisation_etrangere_sont_indiscernables(self):
        self.client.force_login(self.admin_b)
        etrangere = self.client.get(self.url_tableau(self.orga_a))
        inexistante = self.client.get(reverse('orga_tableau_de_bord', args=['nexiste-pas']))
        self.assertEqual((etrangere.status_code, inexistante.status_code), (404, 404))
        self.assertEqual(etrangere.content, inexistante.content)

    def test_organisation_desactivee_donne_404_meme_a_son_administrateur(self):
        Organisation.objects.filter(pk=self.orga_a.pk).update(actif=False)
        self.client.force_login(self.admin_a)
        self.assertEqual(self.client.get(self.url_tableau(self.orga_a)).status_code, 404)

    def test_methode_post_exigee_pour_valider_une_entree(self):
        self.client.force_login(self.admin_a)
        self.assertEqual(self.client.get(self.url_scan(self.orga_a, self.ev_a)).status_code, 405)

    # -- scan : atomique et sans double validation
    def test_double_scan_refuse(self):
        self.client.force_login(self.controleur_a)
        self.assertEqual(self.scanner(self.orga_a, self.ev_a, self.code_a).json()['result'], 'ok')
        self.assertEqual(self.scanner(self.orga_a, self.ev_a, self.code_a).json()['result'], 'already_used')

    # -- export
    def test_export_csv_colonnes_et_protection_contre_les_formules(self):
        commande = services.reserver(self.ev_a, '=cmd@test.fr', [(self.tp_a.id, 1)])
        services.confirmer_paiement('evt-formule', commande.id, 1000)
        self.client.force_login(self.gestionnaire_a)
        reponse = self.client.get(self.url_export(self.orga_a, self.ev_a))
        self.assertEqual(reponse['Content-Type'], 'text/csv; charset=utf-8')
        texte = reponse.content.decode('utf-8-sig')
        self.assertIn('E-mail,Type de place,N° de billet,Statut,Scanné', texte)
        self.assertIn("'=cmd@test.fr", texte)       # préfixé : jamais interprété comme formule
        self.assertNotIn(',=cmd', texte)

    # -- mixin pour les vues à base de classes
    def test_le_mixin_applique_les_memes_regles(self):
        from django.http import Http404, HttpResponse
        from django.test import RequestFactory
        from django.views import View

        from .acces import OrganisationRequiseMixin

        class VueTest(OrganisationRequiseMixin, View):
            roles = [Membre.ADMIN]

            def get(self, request):
                return HttpResponse(request.organisation.slug)

        def appeler(utilisateur, slug):
            requete = RequestFactory().get('/')
            requete.user = utilisateur
            return VueTest.as_view()(requete, slug=slug)

        self.assertEqual(appeler(self.admin_a, self.orga_a.slug).content.decode(), self.orga_a.slug)
        for utilisateur, slug in [(self.gestionnaire_a, self.orga_a.slug), (self.admin_b, self.orga_a.slug),
                                  (self.admin_a, 'nexiste-pas')]:
            with self.assertRaises(Http404):
                appeler(utilisateur, slug)

    def test_requetes_filtrees_par_organisation(self):
        from django.test import RequestFactory

        from .acces import evenements_de
        requete = RequestFactory().get('/')
        requete.organisation = self.orga_a
        self.assertEqual(list(evenements_de(requete)), [self.ev_a])


# ======================================================================================
# Pages publiques : base vide, textes saisis en admin, états vides
# ======================================================================================
class BaseVideTests(TestCase):
    """Aucune donnée en base : le site ne plante pas et n'affiche rien d'inventé."""

    def test_toutes_les_pages_publiques_s_affichent(self):
        for url in [reverse('accueil'), reverse('evenements'), reverse('evenements') + '?q=rien',
                    reverse('api_evenements')]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 200)

    def test_fiche_inconnue_et_categorie_inconnue_donnent_404(self):
        self.assertEqual(self.client.get(reverse('evenement_detail', args=['nexiste-pas'])).status_code, 404)
        self.assertEqual(self.client.get(reverse('evenements') + '?categorie=nexiste-pas').status_code, 404)

    def test_accueil_vide_message_neutre_et_rien_d_invente(self):
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, 'Aucun événement à venir pour le moment.')
        for invente in ['Bordeaux', 'minutes', 'sécurisé', 'Support', 'Revente', 'Fosse', 'class="hero']:
            self.assertNotContains(r, invente)

    def test_pas_de_section_a_la_une_ni_de_menu_explorer(self):
        r = self.client.get(reverse('accueil'))
        self.assertNotContains(r, 'carousel')
        self.assertNotContains(r, 'Explorer')

    def test_page_evenements_vide(self):
        self.assertContains(self.client.get(reverse('evenements')), 'Aucun événement à venir pour le moment.')


class TextesDuSiteTests(TestCase):
    def test_le_bandeau_n_apparait_que_s_il_est_saisi(self):
        self.assertNotContains(self.client.get(reverse('accueil')), 'class="hero')
        parametres(hero_titre='Ma première ligne\nune *seconde* ligne', hero_texte='Un paragraphe saisi.')
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, 'Ma première ligne')
        self.assertContains(r, '<em>seconde</em>')
        self.assertContains(r, 'Un paragraphe saisi.')
        self.assertNotContains(r, 'class="note"')     # pas d'annotation saisie : pas d'annotation affichée
        self.assertNotContains(r, 'class="photo')     # pas d'image saisie : pas de photo

    def test_les_promesses_n_apparaissent_que_si_saisies(self):
        parametres(hero_titre='Titre', hero_annotation='Annotation saisie')
        self.assertContains(self.client.get(reverse('accueil')), 'Annotation saisie')
        parametres(hero_annotation='')
        self.assertNotContains(self.client.get(reverse('accueil')), 'Annotation saisie')

    def test_le_texte_saisi_est_echappe(self):
        parametres(hero_titre='<script>alert(1)</script>')
        r = self.client.get(reverse('accueil'))
        self.assertNotContains(r, '<script>alert(1)</script>')
        self.assertContains(r, '&lt;script&gt;')

    def test_nom_du_site_dans_le_titre_et_la_navigation(self):
        parametres(nom_site='Mon Site')
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, '<title>Mon Site</title>', html=True)
        self.assertContains(r, 'Mon Site')

    def test_contact_affiche_seulement_si_saisi(self):
        self.assertNotContains(self.client.get(reverse('accueil')), 'mailto:')
        parametres(email_contact='contact@test.fr')
        self.assertContains(self.client.get(reverse('accueil')), 'mailto:contact@test.fr')

    def test_titre_de_la_section_a_la_une_saisi(self):
        creer_evenement(a_la_une=True)
        self.assertNotContains(self.client.get(reverse('accueil')), 'section-title')
        parametres(titre_a_la_une='Mon *titre* de section')
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, 'Mon <em>titre</em> de section')


@HACHAGE_RAPIDE
class NavigationTests(TestCase):
    def test_categories_actives_dans_l_ordre_et_inactives_masquees(self):
        Categorie.objects.create(nom='Zèbre', ordre=2)
        Categorie.objects.create(nom='Alpaga', ordre=1)
        Categorie.objects.create(nom='Cachée', ordre=0, actif=False)
        r = self.client.get(reverse('accueil'))
        contenu = r.content.decode()
        self.assertLess(contenu.index('Alpaga'), contenu.index('Zèbre'))
        self.assertNotContains(r, 'Cachée')
        self.assertContains(r, '?categorie=alpaga')

    def test_nombre_de_categories_dans_la_barre_vient_des_parametres(self):
        for i in range(3):
            Categorie.objects.create(nom=f'Cat{i}', ordre=i)
        parametres(nombre_categories_barre=1)
        r = self.client.get(reverse('accueil'))
        barre = r.content.decode().split('class="cats"')[1].split('class="has-mega"')[0]
        self.assertEqual(barre.count('?categorie='), 1)

    def test_villes_viennent_des_lieux_ayant_des_evenements_a_venir(self):
        lieu = Lieu.objects.create(nom='Salle', ville='Ville-Test')
        Lieu.objects.create(nom='Vide', ville='Ville-Sans-Evenement')
        creer_evenement(lieu=lieu)
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, 'Ville-Test')
        self.assertNotContains(r, 'Ville-Sans-Evenement')

    def test_bouton_compte_toujours_present(self):
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, 'class="act act-solid"')
        self.assertContains(r, 'Compte', count=3)   # bouton de la barre (libellé + étiquette) et navigation du bas

    def test_espace_organisateur_seulement_pour_le_personnel(self):
        self.assertNotContains(self.client.get(reverse('accueil')), 'Espace organisateur')
        self.client.force_login(get_user_model().objects.create_user(email='staff@test.fr', password='x' * 12, is_staff=True))
        self.assertContains(self.client.get(reverse('accueil')), 'Espace organisateur')


class CartesEtAccueilTests(TestCase):
    def test_section_a_la_une_seulement_avec_des_evenements_a_la_une(self):
        creer_evenement(titre='Pas à la une')
        self.assertNotContains(self.client.get(reverse('accueil')), 'data-effect="carousel"')
        creer_evenement(titre='Mis en avant', a_la_une=True)
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, 'data-effect="carousel"')
        self.assertContains(r, 'Mis en avant')
        self.assertNotContains(r, 'Pas à la une</a></h3>')

    def test_nombre_d_evenements_a_la_une_vient_des_parametres(self):
        for i in range(3):
            creer_evenement(titre=f'Evt{i}', jours=10 + i, a_la_une=True)
        parametres(nombre_evenements_a_la_une=2)
        self.assertContains(self.client.get(reverse('accueil')), 'class="ticket-wrap"', count=2)

    def test_badges_selon_le_seuil_des_parametres(self):
        ev, tp = creer_evenement(capacite=100, a_la_une=True)
        r = lambda: self.client.get(reverse('accueil'))
        TypePlace.objects.filter(pk=tp.pk).update(vendues=50)
        self.assertNotContains(r(), 'urgency')                         # 50 % restants : rien
        TypePlace.objects.filter(pk=tp.pk).update(vendues=85)
        self.assertContains(r(), 'Plus que 15 places')                 # 15 % < 20 %
        parametres(seuil_dernieres_places_pct=10)
        self.assertNotContains(r(), 'urgency')                         # le seuil est modifiable
        TypePlace.objects.filter(pk=tp.pk).update(vendues=100)
        self.assertContains(r(), "Complet · liste d'attente")

    def test_la_limite_exacte_n_est_pas_une_derniere_place(self):
        ev, tp = creer_evenement(capacite=100, a_la_une=True)
        TypePlace.objects.filter(pk=tp.pk).update(vendues=80)          # exactement 20 % : « moins de 20 % » est faux
        self.assertNotContains(self.client.get(reverse('accueil')), 'urgency')

    def test_prix_formates_et_gratuit(self):
        creer_evenement(titre='Payant', prix=1250, a_la_une=True)
        creer_evenement(titre='Offert', prix=0, jours=31, a_la_une=True)
        parametres(devise='CHF')
        r = self.client.get(reverse('accueil'))
        self.assertContains(r, '12,50\xa0CHF')
        self.assertContains(r, 'Gratuit')

    def test_prix_early_affiche_puis_prix_normal(self):
        ev, tp = creer_evenement(prix=3000, a_la_une=True)
        early = Tarif.objects.create(type_place=tp, prix_centimes=2000, valide_jusqua=timezone.now() + timedelta(days=1))
        self.assertContains(self.client.get(reverse('accueil')), '20\xa0€')
        early.valide_jusqua = timezone.now() - timedelta(days=1)
        early.save()
        self.assertContains(self.client.get(reverse('accueil')), '30\xa0€')

    def test_carte_sans_image_utilise_la_couleur_de_la_categorie(self):
        cat = Categorie.objects.create(nom='Couleur', couleur='#123456')
        creer_evenement(categorie=cat, a_la_une=True)
        self.assertContains(self.client.get(reverse('accueil')), '--fond:#123456')

    def test_heure_affichee_dans_le_fuseau_du_lieu(self):
        ev, _ = creer_evenement(fuseau_horaire='America/Montreal', a_la_une=True)
        ev.debut = timezone.datetime(2027, 1, 15, 0, 30, tzinfo=timezone.get_fixed_timezone(0))   # 00h30 UTC
        ev.save()
        # à Montréal (UTC-5 en janvier) : 19h30 la veille
        self.assertContains(self.client.get(reverse('accueil')), '19:30')

    def test_evenement_en_ligne_expose_l_heure_utc_pour_le_visiteur(self):
        creer_evenement(est_en_ligne=True, a_la_une=True)
        self.assertContains(self.client.get(reverse('accueil')), 'data-effect="local-time"')

    def test_evenements_non_publies_ou_passes_ne_sont_jamais_affiches(self):
        creer_evenement(titre='Brouillon', publie=False, a_la_une=True)
        creer_evenement(titre='Passé', jours=-3, a_la_une=True)
        r = self.client.get(reverse('accueil'))
        self.assertNotContains(r, 'Brouillon')
        self.assertNotContains(r, 'Passé')
        self.assertEqual(self.client.get(reverse('evenement_detail', args=['brouillon'])).status_code, 404)


class RechercheTests(TestCase):
    def setUp(self):
        self.categorie = Categorie.objects.create(nom='Jazz')
        self.lieu = Lieu.objects.create(nom='Salle Aurore', ville='Lyon')
        self.evenement, self.type_place = creer_evenement(
            titre='Soirée Alpha', artiste='Les Marmottes', description='Une ambiance chaleureuse',
            categorie=self.categorie, lieu=self.lieu)

    def trouve(self, q):
        return self.client.get(reverse('evenements'), {'q': q})

    def test_recherche_dans_tous_les_champs(self):
        for requete in ['alpha', 'marmottes', 'chaleureuse', 'jazz', 'aurore', 'lyon']:
            with self.subTest(requete=requete):
                self.assertContains(self.trouve(requete), 'Soirée Alpha')

    def test_chaque_mot_doit_correspondre(self):
        self.assertContains(self.trouve('alpha lyon'), 'Soirée Alpha')
        self.assertContains(self.trouve('alpha paris'), 'Aucun événement pour')

    def test_pas_de_doublon_avec_plusieurs_types_de_place(self):
        TypePlace.objects.create(evenement=self.evenement, nom='VIP', capacite=5, prix_base_centimes=5000)
        TypePlace.objects.create(evenement=self.evenement, nom='Balcon', capacite=5, prix_base_centimes=3000)
        self.assertContains(self.trouve('alpha'), 'class="ticket-wrap"', count=1)

    def test_tri_par_date(self):
        creer_evenement(titre='Soirée Zeta', jours=5)
        contenu = self.trouve('soirée').content.decode()
        self.assertLess(contenu.index('Soirée Zeta'), contenu.index('Soirée Alpha'))

    def test_page_de_categorie(self):
        creer_evenement(titre='Autre chose', jours=5)
        r = self.client.get(reverse('evenements'), {'categorie': 'jazz'})
        self.assertContains(r, 'Soirée Alpha')
        self.assertNotContains(r, 'Autre chose')
        self.assertContains(r, '<h1')
        self.assertContains(r, 'Jazz')

    def test_categorie_inactive_donne_404(self):
        Categorie.objects.filter(pk=self.categorie.pk).update(actif=False)
        self.assertEqual(self.client.get(reverse('evenements'), {'categorie': 'jazz'}).status_code, 404)

    def test_titre_avec_le_mot_recherche_en_italique(self):
        self.assertContains(self.trouve('alpha'), '<em>« alpha »</em>')

    def test_saisie_echappee(self):
        r = self.trouve('<script>alert(1)</script>')
        self.assertNotContains(r, '<script>alert(1)</script>')

    def test_aucun_resultat_propose_des_categories_et_un_retour(self):
        r = self.trouve('introuvable')
        self.assertContains(r, 'Aucun événement pour')
        self.assertContains(r, '?categorie=jazz')
        self.assertContains(r, 'Voir toute la programmation')

    def test_fiche_evenement(self):
        r = self.client.get(reverse('evenement_detail', args=[self.evenement.slug]))
        self.assertContains(r, 'Soirée Alpha')
        self.assertContains(r, 'Les Marmottes')
        self.assertContains(r, 'Standard')


# ======================================================================================
# Admin et commande d'initialisation
# ======================================================================================
@HACHAGE_RAPIDE
class AdminTests(TestCase):
    def setUp(self):
        self.client.force_login(get_user_model().objects.create_superuser(email='chef@test.fr', password='x' * 12))

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
            'types_place-TOTAL_FORMS': '2', 'types_place-INITIAL_FORMS': '0', 'types_place-MIN_NUM_FORMS': '0',
            'types_place-MAX_NUM_FORMS': '1000',
            'types_place-0-nom': 'Fosse', 'types_place-0-capacite': '100', 'types_place-0-prix_base_centimes': '2500',
            'types_place-1-nom': 'Balcon', 'types_place-1-capacite': '50', 'types_place-1-prix_base_centimes': '1800',
        })
        self.assertEqual(r.status_code, 302, getattr(r, 'context', None) and r.context['adminform'].form.errors)
        self.assertEqual(Evenement.objects.get(slug='saisi-en-admin').types_place.count(), 2)


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
