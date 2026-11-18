"""
Tests de l'API de l'organisateur (api_organisateur.py, gestion.py) : cloisonnement entre collectifs, rôles, création,
modification, annulation et suppression d'événements. Chaque test crée ses propres données avec les fabriques.
"""
import json
from datetime import datetime, timedelta, timezone as dt_timezone

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from . import services
from .fabriques import creer_evenement, creer_organisation, creer_utilisateur, en_tete_auth
from .models import Billet, Commande, Evenement, Lieu, Membre, Organisation, Tarif, TypePlace

HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


def acheter(evenement, type_place, email='acheteur@test.fr', quantite=1, utilisateur=None):
    commande = services.reserver(evenement, email, [(type_place.id, quantite)], utilisateur=utilisateur)
    services.confirmer_paiement(f'evt-{commande.pk}', commande.pk, commande.total_centimes)
    return commande


def saisie(**changements):
    """Le corps JSON d'un événement, tel que l'envoie le formulaire de l'application."""
    corps = {
        'name': 'Soirée test', 'location': 'La Rock School Barbey, Bordeaux', 'date': '2099-07-15', 'startTime': '20:00',
        'doorsOpenTime': '19:30', 'timezone': 'Europe/Paris', 'currency': 'EUR', 'cancellationDeadline': '2099-07-14', 'status': 'on_sale',
        'ticketTypes': [
            {'name': 'Fosse', 'price': 20, 'quantity': 100, 'earlyPrice': 15, 'earlyPriceDeadline': '2099-06-30'},
            {'name': 'Balcon', 'price': 30.5, 'quantity': 50},
        ],
    }
    corps.update(changements)
    return corps


class OrganisateurTestCase(TestCase):
    def appel(self, utilisateur, methode, nom_url, args=(), corps=None, params=''):
        url = reverse(nom_url, args=args) + params
        client = getattr(self.client, methode)
        en_tete = en_tete_auth(utilisateur) if utilisateur else {}
        if corps is None:
            return client(url, headers=en_tete)
        return client(url, json.dumps(corps), content_type='application/json', headers=en_tete)


# ======================================================================================
# Cloisonnement : un collectif ne voit JAMAIS rien d'un autre
# ======================================================================================
@HACHAGE_RAPIDE
class CloisonnementOrganisateurApiTests(OrganisateurTestCase):
    def setUp(self):
        self.orga_a, self.orga_b = creer_organisation('Collectif A'), creer_organisation('Collectif B')
        self.ev_a, self.tp_a = creer_evenement(self.orga_a, titre='Événement du collectif A', prix=1000)
        self.ev_b, self.tp_b = creer_evenement(self.orga_b, titre='Événement du collectif B', prix=2000)
        acheter(self.ev_a, self.tp_a, 'acheteur-a@test.fr')
        acheter(self.ev_b, self.tp_b, 'acheteur-b@test.fr')
        self.code_a, self.code_b = Billet.objects.get(type_place=self.tp_a).code, Billet.objects.get(type_place=self.tp_b).code

        self.admin_a = creer_utilisateur('admin-a@test.fr')
        self.gestionnaire_a = creer_utilisateur('gestionnaire-a@test.fr')
        self.controleur_a = creer_utilisateur('controleur-a@test.fr')
        self.admin_b = creer_utilisateur('admin-b@test.fr')
        self.sans_organisation = creer_utilisateur('seul@test.fr')
        self.superuser = get_user_model().objects.create_superuser(username='root', email='root@test.fr', password='x' * 12)
        Membre.objects.create(utilisateur=self.admin_a, organisation=self.orga_a, role=Membre.ADMIN)
        Membre.objects.create(utilisateur=self.gestionnaire_a, organisation=self.orga_a, role=Membre.GESTIONNAIRE)
        Membre.objects.create(utilisateur=self.controleur_a, organisation=self.orga_a, role=Membre.CONTROLEUR)
        Membre.objects.create(utilisateur=self.admin_b, organisation=self.orga_b, role=Membre.ADMIN)

    def pages_de(self, utilisateur, evenement, orga):
        """Toutes les lectures possibles sur l'événement d'un collectif : [(méthode, nom d'adresse, arguments, paramètres)]."""
        return [('get', 'api_orga_evenements', (), f'?collectiveId={orga.pk}'),
                ('get', 'api_orga_resume', (), f'?collectiveId={orga.pk}'),
                ('get', 'api_orga_evenement', (evenement.pk,), ''), ('get', 'api_orga_types_place', (evenement.pk,), ''),
                ('get', 'api_orga_stats', (evenement.pk,), ''), ('get', 'api_orga_participants', (evenement.pk,), '')]

    def statuts(self, utilisateur, evenement, orga):
        return {(methode, nom): self.appel(utilisateur, methode, nom, args, params=params).status_code
                for methode, nom, args, params in self.pages_de(utilisateur, evenement, orga)}

    # -- membres d'un collectif : accès normal à SES données
    def test_admin_et_gestionnaire_accedent_a_leur_collectif(self):
        for utilisateur in (self.admin_a, self.gestionnaire_a):
            with self.subTest(utilisateur=utilisateur.email):
                self.assertEqual(set(self.statuts(utilisateur, self.ev_a, self.orga_a).values()), {200})
                self.assertEqual(self.appel(utilisateur, 'post', 'api_orga_scan', (self.ev_a.pk,), {'code': 'x'}).status_code, 200)

    def test_sans_collectif_precise_on_travaille_sur_son_premier_collectif(self):
        corps = self.appel(self.admin_a, 'get', 'api_orga_evenements').json()
        self.assertEqual([e['name'] for e in corps['results']], ['Événement du collectif A'])

    def test_le_controleur_ne_voit_que_le_scanner(self):
        for cle, statut in self.statuts(self.controleur_a, self.ev_a, self.orga_a).items():
            with self.subTest(cle=cle):
                self.assertEqual(statut, 404)
        self.assertEqual(self.appel(self.controleur_a, 'post', 'api_orga_scan', (self.ev_a.pk,), {'code': self.code_a}).json()['result'], 'ok')

    # -- isolation : un membre de B n'accède à RIEN de A (lecture, écriture, annulation, scan)
    def test_membre_de_b_n_accede_a_rien_de_a(self):
        for cle, statut in self.statuts(self.admin_b, self.ev_a, self.orga_a).items():
            with self.subTest(cle=cle):
                self.assertEqual(statut, 404)
        ecritures = [('put', 'api_orga_evenement', (self.ev_a.pk,), saisie()), ('delete', 'api_orga_evenement', (self.ev_a.pk,), None),
                     ('post', 'api_orga_annuler', (self.ev_a.pk,), {}), ('post', 'api_orga_scan', (self.ev_a.pk,), {'code': self.code_a}),
                     ('post', 'api_orga_image', (self.ev_a.pk,), {}), ('delete', 'api_orga_image', (self.ev_a.pk,), None)]
        for methode, nom, args, corps in ecritures:
            with self.subTest(methode=methode, nom=nom):
                reponse = self.appel(self.admin_b, methode, nom, args, corps)
                self.assertEqual(reponse.status_code, 404)
        # rien n'a bougé
        self.ev_a.refresh_from_db()
        self.assertEqual((self.ev_a.titre, self.ev_a.annule, self.ev_a.publie), ('Événement du collectif A', False, True))
        self.assertEqual(Billet.objects.get(code=self.code_a).statut, Billet.VALIDE)

    def test_et_reciproquement(self):
        for cle, statut in self.statuts(self.admin_a, self.ev_b, self.orga_b).items():
            with self.subTest(cle=cle):
                self.assertEqual(statut, 404)
        self.assertEqual(self.appel(self.admin_a, 'post', 'api_orga_scan', (self.ev_b.pk,), {'code': self.code_b}).status_code, 404)
        self.assertEqual(Billet.objects.get(code=self.code_b).statut, Billet.VALIDE)

    def test_creer_un_evenement_dans_le_collectif_d_un_autre_est_refuse(self):
        reponse = self.appel(self.admin_a, 'post', 'api_orga_evenements', corps=saisie(collectiveId=str(self.orga_b.pk), name='Intrus'))
        self.assertEqual(reponse.status_code, 404)
        self.assertFalse(Evenement.objects.filter(titre='Intrus').exists())
        self.assertEqual(self.appel(self.admin_a, 'get', 'api_orga_evenements', params=f'?collectiveId={self.orga_b.pk}').status_code, 404)

    def test_aucune_donnee_de_l_autre_collectif_dans_les_reponses(self):
        donnees = self.appel(self.admin_a, 'get', 'api_orga_evenements').json()
        texte = json.dumps(donnees, ensure_ascii=False)   # lisible : « É » et non « \u00c9 », sinon la recherche ci-dessous serait vide de sens
        self.assertIn('Événement du collectif A', texte)
        self.assertNotIn('Événement du collectif B', texte)
        self.assertNotIn('Collectif B', texte)
        export = self.appel(self.admin_a, 'get', 'api_orga_participants', (self.ev_a.pk,)).content.decode()
        self.assertIn('acheteur-a@test.fr', export)
        self.assertNotIn('acheteur-b@test.fr', export)
        self.assertNotIn(self.code_b, export)
        self.assertEqual(self.appel(self.admin_a, 'get', 'api_orga_resume').json(),
                         {'results': [{'currency': 'EUR', 'revenue': 10, 'sold': 1, 'refunds': {'count': 0, 'amount': 0}}]})

    def test_un_code_d_un_autre_evenement_est_traite_comme_inconnu(self):
        """Même dans son propre collectif, un billet d'un autre événement n'est pas validé."""
        autre_ev, autre_tp = creer_evenement(self.orga_a, titre='Autre événement de A')
        acheter(autre_ev, autre_tp, 'z@test.fr')
        code_autre = Billet.objects.get(type_place=autre_tp).code
        self.assertEqual(self.appel(self.admin_a, 'post', 'api_orga_scan', (self.ev_a.pk,), {'code': code_autre}).json()['result'], 'invalid')
        self.assertEqual(Billet.objects.get(code=code_autre).statut, Billet.VALIDE)

    # -- ce qui ne doit rien révéler
    def test_anonyme_sans_collectif_et_superuser_non_membre(self):
        self.assertEqual(set(self.statuts(None, self.ev_a, self.orga_a).values()), {401})   # pas connecté : 401
        for utilisateur in (self.sans_organisation, self.superuser):
            with self.subTest(utilisateur=utilisateur.email):
                self.assertEqual(set(self.statuts(utilisateur, self.ev_a, self.orga_a).values()), {404})
                self.assertEqual(self.appel(utilisateur, 'post', 'api_orga_scan', (self.ev_a.pk,), {'code': self.code_a}).status_code, 404)

    def test_collectif_inexistant_evenement_inexistant_et_etranger_sont_indiscernables(self):
        etranger = self.appel(self.admin_b, 'get', 'api_orga_evenement', (self.ev_a.pk,))
        inexistant = self.appel(self.admin_b, 'get', 'api_orga_evenement', (999999,))
        invalide = self.appel(self.admin_b, 'get', 'api_orga_evenement', ('abc',))
        self.assertEqual({etranger.status_code, inexistant.status_code, invalide.status_code}, {404})
        self.assertEqual(etranger.content, inexistant.content)
        self.assertEqual(etranger.content, invalide.content)
        collectif_etranger = self.appel(self.admin_b, 'get', 'api_orga_evenements', params=f'?collectiveId={self.orga_a.pk}')
        collectif_inexistant = self.appel(self.admin_b, 'get', 'api_orga_evenements', params='?collectiveId=999999')
        self.assertEqual((collectif_etranger.status_code, collectif_inexistant.status_code), (404, 404))
        self.assertEqual(collectif_etranger.content, collectif_inexistant.content)

    def test_collectif_desactive_donne_404_meme_a_son_administrateur(self):
        Organisation.objects.filter(pk=self.orga_a.pk).update(actif=False)
        self.assertEqual(set(self.statuts(self.admin_a, self.ev_a, self.orga_a).values()), {404})
        self.assertEqual(self.appel(self.admin_a, 'post', 'api_orga_scan', (self.ev_a.pk,), {'code': self.code_a}).status_code, 404)

    def test_membre_de_plusieurs_collectifs_choisit_celui_sur_lequel_il_travaille(self):
        Membre.objects.create(utilisateur=self.admin_a, organisation=self.orga_b, role=Membre.GESTIONNAIRE)
        defaut = self.appel(self.admin_a, 'get', 'api_orga_evenements').json()['results']
        self.assertEqual([e['name'] for e in defaut], ['Événement du collectif A'])   # « Collectif A » vient avant « Collectif B »
        chez_b = self.appel(self.admin_a, 'get', 'api_orga_evenements', params=f'?collectiveId={self.orga_b.pk}').json()['results']
        self.assertEqual([e['name'] for e in chez_b], ['Événement du collectif B'])

    def test_la_methode_post_est_exigee_pour_valider_une_entree(self):
        self.assertEqual(self.appel(self.admin_a, 'get', 'api_orga_scan', (self.ev_a.pk,)).status_code, 405)

    def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_d_evenements(self):
        with CaptureQueriesContext(connection) as un:
            self.appel(self.admin_a, 'get', 'api_orga_evenements')
        for i in range(5):
            creer_evenement(self.orga_a, titre=f'Autre {i}', jours=2 + i)
        with CaptureQueriesContext(connection) as six:
            reponse = self.appel(self.admin_a, 'get', 'api_orga_evenements')
        self.assertEqual(len(reponse.json()['results']), 6)
        self.assertEqual(len(un), len(six))


# ======================================================================================
# Création
# ======================================================================================
@HACHAGE_RAPIDE
class CreerEvenementApiTests(OrganisateurTestCase):
    def setUp(self):
        self.orga = creer_organisation('Collectif A')
        self.divine = creer_utilisateur('divine@test.fr')
        Membre.objects.create(utilisateur=self.divine, organisation=self.orga, role=Membre.GESTIONNAIRE)

    def creer(self, corps=None, **changements):
        return self.appel(self.divine, 'post', 'api_orga_evenements', corps=saisie(**changements) if corps is None else corps)

    def test_creation_reussie(self):
        reponse = self.creer()
        self.assertEqual(reponse.status_code, 201)
        corps = reponse.json()
        self.assertEqual({k: corps[k] for k in ('name', 'location', 'date', 'startTime', 'doorsOpenTime', 'timezone', 'currency',
                                                'cancellationDeadline', 'status', 'collectiveId', 'isOnline')}, {
            'name': 'Soirée test', 'location': 'La Rock School Barbey, Bordeaux', 'date': '2099-07-15', 'startTime': '20:00',
            'doorsOpenTime': '19:30', 'timezone': 'Europe/Paris', 'currency': 'EUR', 'cancellationDeadline': '2099-07-14',
            'status': 'on_sale', 'collectiveId': str(self.orga.pk), 'isOnline': False})
        self.assertEqual(corps['fromPrice'], 15)   # le tarif early est en cours
        evenement = Evenement.objects.get()
        self.assertEqual(evenement.organisation, self.orga)
        self.assertTrue(evenement.publie)
        self.assertEqual(evenement.debut, datetime(2099, 7, 15, 18, 0, tzinfo=dt_timezone.utc))   # 20:00 à Paris en été
        self.assertEqual(evenement.date_limite_annulation, datetime(2099, 7, 14, 21, 59, 59, tzinfo=dt_timezone.utc))   # fin du 14, heure de Paris
        self.assertEqual(evenement.lieu_texte, 'La Rock School Barbey, Bordeaux')

    def test_types_de_places_prix_en_centimes_et_tarif_early(self):
        self.creer()
        fosse, balcon = TypePlace.objects.order_by('pk')
        self.assertEqual((fosse.nom, fosse.capacite, fosse.prix_base_centimes), ('Fosse', 100, 2000))
        self.assertEqual((balcon.nom, balcon.capacite, balcon.prix_base_centimes), ('Balcon', 50, 3050))
        tarif = Tarif.objects.get()
        self.assertEqual((tarif.type_place, tarif.prix_centimes), (fosse, 1500))
        self.assertEqual(tarif.valide_jusqua, datetime(2099, 6, 30, 21, 59, 59, tzinfo=dt_timezone.utc))   # fin du 30 juin, heure de Paris

    def test_monnaie_sans_centimes(self):
        reponse = self.creer(currency='xof', ticketTypes=[{'name': 'Accès', 'price': 5000, 'quantity': 500}])
        self.assertEqual((reponse.status_code, reponse.json()['currency']), (201, 'XOF'))
        self.assertEqual(TypePlace.objects.get().prix_base_centimes, 500000)
        refus = self.creer(currency='XOF', ticketTypes=[{'name': 'Accès', 'price': 5000.5, 'quantity': 500}])
        self.assertEqual(refus.status_code, 400)
        self.assertIn('tickets.0.price', refus.json()['fields'])

    def test_evenement_en_ligne(self):
        corps = self.creer(location='  en LIGNE ').json()
        self.assertEqual((corps['location'], corps['isOnline']), ('En ligne', True))
        evenement = Evenement.objects.get()
        self.assertEqual((evenement.est_en_ligne, evenement.lieu_texte), (True, ''))

    def test_brouillon_sans_aucune_place_et_sans_heure_des_portes(self):
        corps = self.creer(status='draft', ticketTypes=[], doorsOpenTime='', cancellationDeadline='').json()
        self.assertEqual((corps['status'], corps['doorsOpenTime']), ('draft', None))
        self.assertFalse(Evenement.objects.get().publie)
        self.assertIsNone(Evenement.objects.get().date_limite_annulation)   # le délai par défaut du site s'appliquera

    def test_un_prix_a_zero_est_une_place_gratuite(self):
        corps = self.creer(ticketTypes=[{'name': 'Gratuit', 'price': 0, 'quantity': 10}]).json()
        self.assertEqual(corps['fromPrice'], 0)

    def test_les_prix_peuvent_etre_envoyes_en_texte(self):
        self.assertEqual(self.creer(ticketTypes=[{'name': 'A', 'price': '19,99', 'quantity': 10}]).status_code, 201)
        self.assertEqual(TypePlace.objects.get().prix_base_centimes, 1999)

    def test_les_erreurs_ont_les_cles_du_formulaire_de_l_application(self):
        reponse = self.creer({'status': 'nimporte', 'ticketTypes': 'oups'})
        self.assertEqual(reponse.status_code, 400)
        corps = reponse.json()
        self.assertEqual(corps['error'], 'validation')
        self.assertEqual(set(corps['fields']), {'name', 'location', 'timezone', 'date', 'startTime', 'currency', 'status', 'tickets'})
        self.assertFalse(Evenement.objects.exists())

    def test_champs_invalides_un_par_un(self):
        cas = {
            'name': ({'name': '   '}, 'name'), 'nom trop long': ({'name': 'x' * 201}, 'name'),
            'location': ({'location': ''}, 'location'), 'fuseau': ({'timezone': 'Mars/Phobos'}, 'timezone'),
            'date': ({'date': '18/11/2026'}, 'date'), 'date impossible': ({'date': '2026-02-30'}, 'date'),
            'heure': ({'startTime': '25:00'}, 'startTime'), 'portes': ({'doorsOpenTime': '7h'}, 'doorsOpenTime'),
            'monnaie': ({'currency': 'EURO'}, 'currency'), 'limite': ({'cancellationDeadline': 'demain'}, 'cancellationDeadline'),
            'limite après l\'événement': ({'cancellationDeadline': '2099-07-16'}, 'cancellationDeadline'),
            'statut annulé': ({'status': 'canceled'}, 'status'), 'statut complet': ({'status': 'sold_out'}, 'status'),
        }
        for nom, (changement, champ) in cas.items():
            with self.subTest(nom):
                reponse = self.creer(**changement)
                self.assertEqual(reponse.status_code, 400)
                self.assertIn(champ, reponse.json()['fields'])
        self.assertFalse(Evenement.objects.exists())

    def test_erreurs_sur_les_types_de_places(self):
        cas = {
            'nom': ({'name': '', 'price': 10, 'quantity': 5}, 'tickets.0.name'),
            'prix manquant': ({'name': 'A', 'quantity': 5}, 'tickets.0.price'),
            'prix négatif': ({'name': 'A', 'price': -1, 'quantity': 5}, 'tickets.0.price'),
            'prix illisible': ({'name': 'A', 'price': 'cher', 'quantity': 5}, 'tickets.0.price'),
            'trop de décimales': ({'name': 'A', 'price': 10.555, 'quantity': 5}, 'tickets.0.price'),
            'quantité nulle': ({'name': 'A', 'price': 10, 'quantity': 0}, 'tickets.0.quantity'),
            'quantité décimale': ({'name': 'A', 'price': 10, 'quantity': 2.5}, 'tickets.0.quantity'),
            'quantité texte': ({'name': 'A', 'price': 10, 'quantity': '5'}, 'tickets.0.quantity'),
            'early sans date': ({'name': 'A', 'price': 10, 'quantity': 5, 'earlyPrice': 5}, 'tickets.0.earlyPriceDeadline'),
            'early sans prix': ({'name': 'A', 'price': 10, 'quantity': 5, 'earlyPriceDeadline': '2099-01-01'}, 'tickets.0.earlyPrice'),
            'early pas moins cher': ({'name': 'A', 'price': 10, 'quantity': 5, 'earlyPrice': 10, 'earlyPriceDeadline': '2099-01-01'}, 'tickets.0.earlyPrice'),
            'date early illisible': ({'name': 'A', 'price': 10, 'quantity': 5, 'earlyPrice': 5, 'earlyPriceDeadline': 'bientôt'}, 'tickets.0.earlyPriceDeadline'),
            'identifiant illisible': ({'id': 'x1', 'name': 'A', 'price': 10, 'quantity': 5}, 'tickets.0.id'),
        }
        for nom, (type_place, champ) in cas.items():
            with self.subTest(nom):
                reponse = self.creer(ticketTypes=[type_place])
                self.assertEqual(reponse.status_code, 400)
                self.assertIn(champ, reponse.json()['fields'])
        self.assertFalse(Evenement.objects.exists())

    def test_mettre_en_vente_exige_au_moins_une_place(self):
        reponse = self.creer(ticketTypes=[])
        self.assertEqual(reponse.status_code, 400)
        self.assertIn('tickets', reponse.json()['fields'])

    def test_le_numero_de_la_place_dans_l_erreur_est_le_bon(self):
        reponse = self.creer(ticketTypes=[{'name': 'A', 'price': 10, 'quantity': 5}, {'name': 'B', 'price': 'x', 'quantity': 5}])
        self.assertEqual(set(reponse.json()['fields']), {'tickets.1.price'})

    def test_une_erreur_ne_cree_rien_meme_a_moitie(self):
        self.creer(ticketTypes=[{'name': 'A', 'price': 10, 'quantity': 5}, {'name': '', 'price': 10, 'quantity': 5}])
        self.assertEqual((Evenement.objects.count(), TypePlace.objects.count()), (0, 0))

    def test_corps_illisible_et_connexion_requise(self):
        reponse = self.client.post(reverse('api_orga_evenements'), 'pas du json', content_type='application/json', headers=en_tete_auth(self.divine))
        self.assertEqual(reponse.json()['error'], 'invalid_json')
        self.assertEqual(self.client.post(reverse('api_orga_evenements'), saisie(), content_type='application/json').status_code, 401)

    def test_l_evenement_cree_apparait_dans_la_liste_du_collectif_et_dans_l_api_publique_s_il_est_en_vente(self):
        self.creer(name='En vente')
        self.creer(name='Brouillon', status='draft')
        liste = self.appel(self.divine, 'get', 'api_orga_evenements').json()['results']
        self.assertEqual(sorted(e['name'] for e in liste), ['Brouillon', 'En vente'])
        publics = self.client.get(reverse('api_v1_evenements')).json()['results']
        self.assertEqual([e['name'] for e in publics], ['En vente'])


# ======================================================================================
# Modification, suppression, annulation
# ======================================================================================
@HACHAGE_RAPIDE
class ModifierEvenementApiTests(OrganisateurTestCase):
    def setUp(self):
        self.orga = creer_organisation('Collectif A')
        self.divine = creer_utilisateur('divine@test.fr')
        Membre.objects.create(utilisateur=self.divine, organisation=self.orga, role=Membre.GESTIONNAIRE)
        corps = self.appel(self.divine, 'post', 'api_orga_evenements', corps=saisie()).json()
        self.evenement = Evenement.objects.get(pk=corps['id'])
        self.fosse, self.balcon = TypePlace.objects.order_by('pk')

    def modifier(self, corps=None, **changements):
        return self.appel(self.divine, 'put', 'api_orga_evenement', (self.evenement.pk,), corps if corps is not None else self.corps(**changements))

    def corps(self, **changements):
        """Le formulaire tel que l'application le renvoie après lecture : les places gardent leur identifiant."""
        types = [{'id': str(t.pk), 'name': t.nom, 'price': t.prix_base_centimes / 100, 'quantity': t.capacite} for t in (self.fosse, self.balcon)]
        types[0].update(earlyPrice=15, earlyPriceDeadline='2099-06-30')
        return saisie(**{'ticketTypes': types, **changements})

    def test_modifier_les_informations(self):
        reponse = self.modifier(name='Nouveau nom', startTime='21:15', location='Ailleurs, Paris', doorsOpenTime='')
        self.assertEqual(reponse.status_code, 200)
        corps = reponse.json()
        self.assertEqual((corps['name'], corps['startTime'], corps['location'], corps['doorsOpenTime']), ('Nouveau nom', '21:15', 'Ailleurs, Paris', None))
        self.assertEqual(corps['id'], str(self.evenement.pk))
        self.assertEqual(Evenement.objects.count(), 1)

    def test_un_envoi_identique_ne_change_rien(self):
        avant = self.appel(self.divine, 'get', 'api_orga_evenement', (self.evenement.pk,)).json()
        self.assertEqual(self.modifier().status_code, 200)
        self.assertEqual(self.appel(self.divine, 'get', 'api_orga_evenement', (self.evenement.pk,)).json(), avant)
        self.assertEqual((TypePlace.objects.count(), Tarif.objects.count()), (2, 1))   # pas de doublons

    def test_le_collectif_d_un_evenement_ne_change_jamais(self):
        autre = creer_organisation('Collectif B')
        Membre.objects.create(utilisateur=self.divine, organisation=autre, role=Membre.ADMIN)
        self.modifier(collectiveId=str(autre.pk))
        self.evenement.refresh_from_db()
        self.assertEqual(self.evenement.organisation, self.orga)

    def test_modifier_les_places(self):
        types = [{'id': str(self.fosse.pk), 'name': 'Fosse debout', 'price': 25, 'quantity': 120},   # modifiée, plus de tarif early
                 {'name': 'VIP', 'price': 60, 'quantity': 10}]                                          # nouvelle ; Balcon retirée
        reponse = self.modifier(ticketTypes=types)
        self.assertEqual(reponse.status_code, 200)
        noms = {t.nom: t for t in TypePlace.objects.all()}
        self.assertEqual(set(noms), {'Fosse debout', 'VIP'})
        self.assertEqual(noms['Fosse debout'].pk, self.fosse.pk)   # même place, pas une copie
        self.assertEqual((noms['Fosse debout'].capacite, noms['Fosse debout'].prix_base_centimes), (120, 2500))
        self.assertFalse(Tarif.objects.exists())   # le tarif early a été retiré
        self.assertEqual(noms['VIP'].prix_base_centimes, 6000)

    def test_changer_le_tarif_early(self):
        types = self.corps()['ticketTypes']
        types[0].update(earlyPrice=12, earlyPriceDeadline='2099-05-01')
        self.modifier(ticketTypes=types)
        tarif = Tarif.objects.get()
        self.assertEqual(tarif.prix_centimes, 1200)

    def test_une_place_deja_reservee_ne_peut_pas_etre_supprimee(self):
        acheter(self.evenement, self.balcon)
        reponse = self.modifier(ticketTypes=[self.corps()['ticketTypes'][0]])   # sans le Balcon
        self.assertEqual(reponse.status_code, 400)
        self.assertIn('tickets', reponse.json()['fields'])
        self.assertEqual(TypePlace.objects.count(), 2)

    def test_on_ne_peut_pas_descendre_sous_les_places_vendues_et_retenues(self):
        acheter(self.evenement, self.fosse, quantite=3)
        services.reserver(self.evenement, 'x@test.fr', [(self.fosse.id, 2)])   # 3 vendues + 2 retenues
        types = self.corps()['ticketTypes']
        types[0]['quantity'] = 4
        reponse = self.modifier(ticketTypes=types)
        self.assertEqual(reponse.status_code, 400)
        self.assertIn('tickets.0.quantity', reponse.json()['fields'])
        types[0]['quantity'] = 5   # exactement le nombre de places prises : permis
        self.assertEqual(self.modifier(ticketTypes=types).status_code, 200)

    def test_un_identifiant_de_place_d_un_autre_evenement_est_refuse(self):
        _autre, type_autre = creer_evenement(self.orga, titre='Autre')
        types = self.corps()['ticketTypes']
        types[1]['id'] = str(type_autre.pk)
        reponse = self.modifier(ticketTypes=types)
        self.assertEqual(reponse.status_code, 400)
        self.assertIn('tickets.1.id', reponse.json()['fields'])
        type_autre.refresh_from_db()
        self.assertEqual(type_autre.nom, 'Standard')   # la place de l'autre événement n'a pas été touchée

    def test_la_monnaie_ne_change_plus_apres_une_reservation(self):
        self.assertEqual(self.modifier(currency='USD').status_code, 200)   # encore possible : personne n'a réservé
        acheter(self.evenement, self.fosse)
        reponse = self.modifier(currency='EUR')
        self.assertEqual(reponse.status_code, 400)
        self.assertIn('currency', reponse.json()['fields'])

    def test_un_evenement_en_vente_ne_redevient_pas_brouillon(self):
        reponse = self.modifier(status='draft')
        self.assertEqual(reponse.status_code, 400)
        self.assertIn('status', reponse.json()['fields'])

    def test_un_brouillon_peut_etre_publie(self):
        brouillon = self.appel(self.divine, 'post', 'api_orga_evenements', corps=saisie(status='draft', name='Brouillon')).json()
        reponse = self.appel(self.divine, 'put', 'api_orga_evenement', (brouillon['id'],), saisie(status='on_sale', name='Brouillon'))
        self.assertEqual((reponse.status_code, reponse.json()['status']), (200, 'on_sale'))

    def test_un_evenement_termine_ou_annule_ne_se_modifie_plus(self):
        Evenement.objects.filter(pk=self.evenement.pk).update(debut=timezone.now() - timedelta(days=1))
        reponse = self.modifier()
        self.assertEqual((reponse.status_code, reponse.json()['error']), (409, 'not_editable'))
        Evenement.objects.filter(pk=self.evenement.pk).update(debut=timezone.now() + timedelta(days=5), annule=True)
        self.assertEqual(self.modifier().status_code, 409)

    def test_un_lieu_choisi_dans_l_administration_est_conserve_si_le_lieu_ne_change_pas(self):
        lieu = Lieu.objects.create(nom='Rocher de Palmer', ville='Cenon', adresse='1 rue du Rocher')
        Evenement.objects.filter(pk=self.evenement.pk).update(lieu=lieu, lieu_texte='')
        self.assertEqual(self.appel(self.divine, 'get', 'api_orga_evenement', (self.evenement.pk,)).json()['location'], 'Rocher de Palmer, Cenon')
        self.modifier(location='Rocher de Palmer, Cenon', name='Renommé')
        self.evenement.refresh_from_db()
        self.assertEqual((self.evenement.lieu, self.evenement.lieu_texte, self.evenement.titre), (lieu, '', 'Renommé'))   # adresse et fiche conservées
        self.modifier(location='Ailleurs')
        self.evenement.refresh_from_db()
        self.assertEqual((self.evenement.lieu, self.evenement.lieu_texte), (None, 'Ailleurs'))

    def test_passer_en_ligne_puis_revenir_a_un_lieu(self):
        self.assertEqual(self.modifier(location='En ligne').json()['isOnline'], True)
        corps = self.modifier(location='Salle Pleyel, Paris').json()
        self.assertEqual((corps['isOnline'], corps['location']), (False, 'Salle Pleyel, Paris'))

    def test_les_erreurs_de_modification_ne_changent_rien(self):
        avant = self.appel(self.divine, 'get', 'api_orga_evenement', (self.evenement.pk,)).json()
        types = self.corps()['ticketTypes']
        types[1]['price'] = 'gratuit mais pas vraiment'
        self.assertEqual(self.modifier(name='Changé', ticketTypes=types).status_code, 400)
        self.assertEqual(self.appel(self.divine, 'get', 'api_orga_evenement', (self.evenement.pk,)).json(), avant)

    # -- suppression
    def test_supprimer_un_brouillon(self):
        brouillon = self.appel(self.divine, 'post', 'api_orga_evenements', corps=saisie(status='draft', name='Brouillon')).json()
        self.assertEqual(self.appel(self.divine, 'delete', 'api_orga_evenement', (brouillon['id'],)).status_code, 204)
        self.assertFalse(Evenement.objects.filter(pk=brouillon['id']).exists())
        self.assertEqual(TypePlace.objects.exclude(evenement=self.evenement).count(), 0)   # ses places aussi

    def test_un_evenement_en_vente_ne_se_supprime_pas(self):
        reponse = self.appel(self.divine, 'delete', 'api_orga_evenement', (self.evenement.pk,))
        self.assertEqual((reponse.status_code, reponse.json()['error']), (409, 'not_deletable'))
        self.assertTrue(Evenement.objects.filter(pk=self.evenement.pk).exists())

    def test_un_brouillon_avec_des_reservations_ne_se_supprime_pas(self):
        Evenement.objects.filter(pk=self.evenement.pk).update(publie=False)
        services.reserver(self.evenement, 'x@test.fr', [(self.fosse.id, 1)])
        self.assertEqual(self.appel(self.divine, 'delete', 'api_orga_evenement', (self.evenement.pk,)).status_code, 409)

    # -- annulation
    def test_annuler_un_evenement(self):
        payee = acheter(self.evenement, self.fosse, 'payeur@test.fr', 2)
        en_attente = services.reserver(self.evenement, 'attente@test.fr', [(self.balcon.id, 3)])
        reponse = self.appel(self.divine, 'post', 'api_orga_annuler', (self.evenement.pk,), {})
        self.assertEqual((reponse.status_code, reponse.json()['status']), (200, 'canceled'))
        self.evenement.refresh_from_db()
        self.assertTrue(self.evenement.annule)
        # la réservation en attente est annulée et ses places rendues
        en_attente.refresh_from_db()
        self.assertEqual(en_attente.statut, Commande.ANNULEE)
        self.assertEqual(TypePlace.objects.get(pk=self.balcon.pk).retenues, 0)
        # les billets sont annulés, la commande payée est à rembourser
        self.assertEqual(set(Billet.objects.values_list('statut', flat=True)), {Billet.ANNULE})
        payee.refresh_from_db()
        self.assertTrue(payee.a_rembourser)

    def test_annuler_est_rejouable_sans_effet(self):
        self.appel(self.divine, 'post', 'api_orga_annuler', (self.evenement.pk,), {})
        self.assertEqual(self.appel(self.divine, 'post', 'api_orga_annuler', (self.evenement.pk,), {}).status_code, 200)

    def test_on_n_annule_ni_un_brouillon_ni_un_evenement_termine(self):
        brouillon = self.appel(self.divine, 'post', 'api_orga_evenements', corps=saisie(status='draft', name='Brouillon')).json()
        reponse = self.appel(self.divine, 'post', 'api_orga_annuler', (brouillon['id'],), {})
        self.assertEqual((reponse.status_code, reponse.json()['error']), (409, 'not_cancellable'))
        Evenement.objects.filter(pk=self.evenement.pk).update(debut=timezone.now() - timedelta(hours=2))
        self.assertEqual(self.appel(self.divine, 'post', 'api_orga_annuler', (self.evenement.pk,), {}).status_code, 409)

    def test_un_evenement_annule_disparait_de_l_api_publique_mais_reste_chez_l_organisateur(self):
        self.appel(self.divine, 'post', 'api_orga_annuler', (self.evenement.pk,), {})
        self.assertEqual(self.client.get(reverse('api_v1_evenements')).json(), {'results': []})
        self.assertEqual(self.client.get(reverse('api_v1_evenement', args=[self.evenement.pk])).status_code, 404)
        liste = self.appel(self.divine, 'get', 'api_orga_evenements').json()['results']
        self.assertEqual([e['status'] for e in liste], ['canceled'])

    def test_un_paiement_qui_arrive_apres_l_annulation_est_a_rembourser_et_n_emet_aucun_billet(self):
        commande = services.reserver(self.evenement, 'retard@test.fr', [(self.fosse.id, 1)])
        self.appel(self.divine, 'post', 'api_orga_annuler', (self.evenement.pk,), {})
        resultat = services.confirmer_paiement('evt-retard', commande.pk, commande.total_centimes)
        self.assertEqual(resultat, 'late')
        commande.refresh_from_db()
        self.assertTrue(commande.a_rembourser)
        self.assertFalse(Billet.objects.exists())
