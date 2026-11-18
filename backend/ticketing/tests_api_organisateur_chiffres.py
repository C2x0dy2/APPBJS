"""
Tests de l'API de l'organisateur, deuxième partie : chiffres de vente, scan des billets, export des participants, image
principale. Chaque test crée ses propres données avec les fabriques.
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone

from . import services
from .fabriques import creer_evenement, creer_image, creer_organisation, creer_utilisateur, en_tete_auth
from .models import Billet, Commande, Membre, Tarif, TypePlace
from .tests_api_organisateur import OrganisateurTestCase, acheter
from .tests_images import StockageTemporaire

HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])
PARIS = ZoneInfo('Europe/Paris')


def midi(jour):
    """Midi, heure de Paris, de ce jour : loin des minuits, les tests ne dépendent pas de l'heure d'été."""
    return datetime.combine(jour, time(12, 0), tzinfo=PARIS)


@HACHAGE_RAPIDE
class ChiffresApiTests(OrganisateurTestCase):
    def setUp(self):
        self.orga = creer_organisation('Collectif A')
        self.divine = creer_utilisateur('divine@test.fr')
        Membre.objects.create(utilisateur=self.divine, organisation=self.orga, role=Membre.GESTIONNAIRE)
        # la monnaie est donnée explicitement : le test ne dépend pas de DEVISE_PAR_DEFAUT du fichier .env
        self.evenement, self.fosse = creer_evenement(self.orga, titre='Concert', jours=30, capacite=100, prix=2000, nom_place='Fosse', devise='EUR')
        self.balcon = TypePlace.objects.create(evenement=self.evenement, nom='Balcon', capacite=20, prix_base_centimes=3000)
        self.tarif = Tarif.objects.create(type_place=self.fosse, prix_centimes=1500, valide_jusqua=timezone.now() + timedelta(days=10))
        self.aujourdhui = timezone.now().astimezone(PARIS).date()

    def stats(self, evenement=None):
        reponse = self.appel(self.divine, 'get', 'api_orga_stats', ((evenement or self.evenement).pk,))
        self.assertEqual(reponse.status_code, 200)
        return reponse.json()

    def payee_le(self, commande, jour):
        Commande.objects.filter(pk=commande.pk).update(payee_le=midi(jour))

    def test_evenement_sans_vente(self):
        corps = self.stats()
        self.assertEqual(corps['totals'], {'capacity': 120, 'sold': 0, 'held': 0, 'free': 120, 'fillRate': 0, 'revenue': 0})
        self.assertEqual(corps['refunds'], {'count': 0, 'amount': 0})
        self.assertEqual(corps['entriesScanned'], 0)
        self.assertEqual(len(corps['daily']), 14)
        self.assertEqual({jour['tickets'] for jour in corps['daily']}, {0})
        self.assertEqual(corps['daily'][-1]['date'], self.aujourdhui.isoformat())   # les 14 jours se terminent aujourd'hui
        self.assertEqual(corps['event']['name'], 'Concert')

    def test_les_chiffres_d_un_evenement(self):
        # 1) tarif early en cours : 2 Fosse à 15 €
        premiere = acheter(self.evenement, self.fosse, 'a@test.fr', 2)
        # 2) le tarif early se termine : 1 Fosse et 1 Balcon au prix normal
        Tarif.objects.filter(pk=self.tarif.pk).update(valide_jusqua=timezone.now() - timedelta(days=1))
        seconde = services.reserver(self.evenement, 'b@test.fr', [(self.fosse.id, 1), (self.balcon.id, 1)])
        services.confirmer_paiement('evt-seconde', seconde.pk, seconde.total_centimes)
        # 3) une réservation pas encore payée : 2 Balcon retenues
        services.reserver(self.evenement, 'c@test.fr', [(self.balcon.id, 2)])
        # 4) un paiement reçu trop tard : à rembourser, ce n'est pas du chiffre d'affaires
        Commande.objects.create(evenement=self.evenement, email='d@test.fr', statut=Commande.EXPIREE, total_centimes=2000,
                                expire_le=timezone.now(), a_rembourser=True)
        # 5) un billet scanné à l'entrée
        services.valider_entree(Billet.objects.order_by('pk').first().code)
        # dates de paiement : aujourd'hui, avant-hier, et il y a 20 jours (hors du graphique)
        self.payee_le(premiere, self.aujourdhui)
        self.payee_le(seconde, self.aujourdhui - timedelta(days=2))
        ancienne = acheter(self.evenement, self.balcon, 'e@test.fr')
        self.payee_le(ancienne, self.aujourdhui - timedelta(days=20))

        corps = self.stats()
        par_nom = {t['ticketType']['name']: t for t in corps['types']}
        self.assertEqual((par_nom['Fosse']['sold'], par_nom['Fosse']['held'], par_nom['Fosse']['free']), (3, 0, 97))
        self.assertEqual((par_nom['Balcon']['sold'], par_nom['Balcon']['held'], par_nom['Balcon']['free']), (2, 2, 16))
        # chiffre d'affaires au prix FIGÉ à la réservation : 2 × 15 + 1 × 20 = 50 pour la Fosse
        self.assertEqual((par_nom['Fosse']['revenue'], par_nom['Balcon']['revenue']), (50, 60))
        self.assertEqual(corps['totals'], {'capacity': 120, 'sold': 5, 'held': 2, 'free': 113, 'fillRate': 5 / 120, 'revenue': 110})
        self.assertEqual(corps['refunds'], {'count': 1, 'amount': 20})
        self.assertEqual(corps['entriesScanned'], 1)
        # les ventes par jour sont dans le fuseau de l'événement, et seuls les 14 derniers jours comptent
        par_jour = {j['date']: j['tickets'] for j in corps['daily']}
        self.assertEqual(par_jour[self.aujourdhui.isoformat()], 2)
        self.assertEqual(par_jour[(self.aujourdhui - timedelta(days=2)).isoformat()], 2)
        self.assertEqual(sum(par_jour.values()), 4)   # la vente d'il y a 20 jours n'est pas dans le graphique
        self.assertEqual(corps['types'][0]['ticketType']['sold'], 3)   # le type de place de l'organisateur porte ses ventes

    def test_la_commande_expiree_ou_annulee_n_est_pas_du_chiffre_d_affaires(self):
        commande = services.reserver(self.evenement, 'a@test.fr', [(self.fosse.id, 2)], maintenant=timezone.now() - timedelta(hours=3))
        services.liberer_retenues_expirees()
        corps = self.stats()
        self.assertEqual((corps['totals']['revenue'], corps['totals']['sold'], corps['totals']['held']), (0, 0, 0))
        self.assertEqual(Commande.objects.get(pk=commande.pk).statut, Commande.EXPIREE)

    def test_les_jours_se_terminent_le_jour_de_l_evenement_quand_il_est_passe(self):
        passe, _type = creer_evenement(self.orga, titre='Passé', jours=-5, capacite=10, prix=1000)
        corps = self.stats(passe)
        self.assertEqual(corps['daily'][-1]['date'], passe.debut.astimezone(PARIS).date().isoformat())   # le jour de l'événement
        self.assertEqual(len(corps['daily']), 14)

    def test_un_evenement_annule_ne_rapporte_rien_et_tout_est_a_rembourser(self):
        acheter(self.evenement, self.fosse, 'a@test.fr', 2)   # 2 × 15 € (tarif early) = 30 €
        acheter(self.evenement, self.balcon, 'b@test.fr')   # 30 €
        services.annuler_evenement(self.evenement)
        corps = self.stats()
        self.assertEqual(corps['event']['status'], 'canceled')
        # l'argent reçu est à rendre : ce n'est pas du chiffre d'affaires (ni pour l'événement, ni pour un type de place)
        self.assertEqual(corps['totals']['revenue'], 0)
        self.assertEqual({t['revenue'] for t in corps['types']}, {0})
        self.assertEqual(corps['refunds'], {'count': 2, 'amount': 60})
        self.assertEqual(corps['totals']['sold'], 3)   # les billets ont bien été émis (puis annulés) : le compteur de places le garde
        # même chose dans le résumé du collectif : rien d'encaissé, 60 € à rendre
        self.assertEqual(self.appel(self.divine, 'get', 'api_orga_resume').json(),
                         {'results': [{'currency': 'EUR', 'revenue': 0, 'sold': 0, 'refunds': {'count': 2, 'amount': 60}}]})

    def test_un_paiement_tardif_a_rembourser_n_est_pas_du_chiffre_d_affaires_du_collectif(self):
        acheter(self.evenement, self.fosse, 'a@test.fr')   # 15 €
        Commande.objects.create(evenement=self.evenement, email='d@test.fr', statut=Commande.EXPIREE, total_centimes=2000,
                                expire_le=timezone.now(), a_rembourser=True)
        corps = self.appel(self.divine, 'get', 'api_orga_resume').json()
        self.assertEqual(corps, {'results': [{'currency': 'EUR', 'revenue': 15, 'sold': 1, 'refunds': {'count': 1, 'amount': 20}}]})

    def test_resume_par_monnaie(self):
        acheter(self.evenement, self.fosse, 'a@test.fr', 2)   # 2 × 15 € (tarif early)
        xof, type_xof = creer_evenement(self.orga, titre='Live', devise='XOF', prix=500000, capacite=50)
        acheter(xof, type_xof, 'b@test.fr')
        autre = creer_organisation('Collectif B')
        evenement_b, type_b = creer_evenement(autre, titre='Chez B', prix=9900, devise='EUR')
        acheter(evenement_b, type_b, 'c@test.fr')   # un autre collectif : jamais dans le résumé de A
        sans_rien = {'count': 0, 'amount': 0}
        corps = self.appel(self.divine, 'get', 'api_orga_resume').json()
        self.assertEqual(corps, {'results': [{'currency': 'EUR', 'revenue': 30, 'sold': 2, 'refunds': sans_rien},
                                             {'currency': 'XOF', 'revenue': 5000, 'sold': 1, 'refunds': sans_rien}]})

    def test_resume_vide(self):
        self.assertEqual(self.appel(self.divine, 'get', 'api_orga_resume').json(), {'results': []})

    def test_les_types_de_place_de_l_organisateur_portent_les_ventes_pas_ceux_du_public(self):
        acheter(self.evenement, self.fosse, 'a@test.fr', 3)
        services.reserver(self.evenement, 'b@test.fr', [(self.fosse.id, 2)])
        organisateur = {t['name']: t for t in self.appel(self.divine, 'get', 'api_orga_types_place', (self.evenement.pk,)).json()['results']}
        self.assertEqual((organisateur['Fosse']['sold'], organisateur['Fosse']['held']), (3, 2))
        public = {t['name']: t for t in self.client.get(reverse('api_v1_types_place', args=[self.evenement.pk])).json()['results']}
        self.assertEqual(set(public), {'Fosse', 'Balcon'})
        for fiche in public.values():
            self.assertNotIn('sold', fiche)   # le public ne voit jamais les ventes
            self.assertNotIn('held', fiche)


@HACHAGE_RAPIDE
class ScanApiTests(OrganisateurTestCase):
    def setUp(self):
        self.orga = creer_organisation('Collectif A')
        self.controleur = creer_utilisateur('controleur@test.fr')
        Membre.objects.create(utilisateur=self.controleur, organisation=self.orga, role=Membre.CONTROLEUR)
        self.evenement, self.type_place = creer_evenement(self.orga, titre='Concert', capacite=5, prix=1000, nom_place='Fosse')
        acheter(self.evenement, self.type_place, 'a@test.fr')
        self.code = Billet.objects.get().code

    def scanner(self, code, evenement=None):
        return self.appel(self.controleur, 'post', 'api_orga_scan', ((evenement or self.evenement).pk,), {'code': code})

    def test_un_billet_valide_n_entre_qu_une_fois(self):
        self.assertEqual(self.scanner(self.code).json(), {'result': 'ok', 'ticketType': 'Fosse'})
        self.assertEqual(self.scanner(self.code).json()['result'], 'already_used')
        self.assertEqual(Billet.objects.get().statut, Billet.UTILISE)
        self.assertEqual(self.appel(self.controleur, 'get', 'api_orga_scan', (self.evenement.pk,)).status_code, 405)

    def test_code_inconnu_ou_illisible(self):
        for code in ('inconnu', '', None, 12, ['a']):
            with self.subTest(code=code):
                self.assertEqual(self.scanner(code).json(), {'result': 'invalid'})
        self.assertEqual(Billet.objects.get().statut, Billet.VALIDE)

    def test_un_billet_annule_n_est_pas_valide(self):
        services.annuler_evenement(self.evenement)
        self.assertEqual(self.scanner(self.code).json()['result'], 'invalid')
        self.assertEqual(Billet.objects.get().statut, Billet.ANNULE)

    def test_le_scan_d_un_billet_d_un_autre_evenement_est_invalide(self):
        autre, type_autre = creer_evenement(self.orga, titre='Autre', prix=1000)
        self.assertEqual(self.scanner(self.code, autre).json()['result'], 'invalid')
        self.assertEqual(Billet.objects.get().statut, Billet.VALIDE)


@HACHAGE_RAPIDE
class ExportParticipantsApiTests(OrganisateurTestCase):
    def setUp(self):
        self.orga = creer_organisation('Collectif A')
        self.gestionnaire = creer_utilisateur('gestionnaire@test.fr')
        Membre.objects.create(utilisateur=self.gestionnaire, organisation=self.orga, role=Membre.GESTIONNAIRE)
        self.evenement, self.type_place = creer_evenement(self.orga, titre='Concert', capacite=10, prix=1000, nom_place='Fosse')

    def test_colonnes_et_protection_contre_les_formules(self):
        acheter(self.evenement, self.type_place, '=cmd@test.fr')
        acheter(self.evenement, self.type_place, 'normal@test.fr', 2)
        services.valider_entree(Billet.objects.order_by('pk').first().code)
        reponse = self.appel(self.gestionnaire, 'get', 'api_orga_participants', (self.evenement.pk,))
        self.assertEqual(reponse['Content-Type'], 'text/csv; charset=utf-8')
        self.assertIn('participants-concert.csv', reponse['Content-Disposition'])
        texte = reponse.content.decode('utf-8-sig')
        lignes = texte.strip().splitlines()
        self.assertEqual(lignes[0], 'E-mail,Type de place,N° de billet,Statut,Scanné')
        self.assertEqual(len(lignes), 4)
        self.assertIn("'=cmd@test.fr", texte)   # préfixé : jamais interprété comme formule
        self.assertNotIn(',=cmd', texte)
        self.assertIn('utilise,oui', texte)
        self.assertEqual(texte.count(',non'), 2)

    def test_evenement_sans_participant(self):
        texte = self.appel(self.gestionnaire, 'get', 'api_orga_participants', (self.evenement.pk,)).content.decode('utf-8-sig')
        self.assertEqual(len(texte.strip().splitlines()), 1)   # l'en-tête seul


@HACHAGE_RAPIDE
class ImagePrincipaleApiTests(StockageTemporaire, OrganisateurTestCase):
    def setUp(self):
        self.orga = creer_organisation('Collectif A')
        self.divine = creer_utilisateur('divine@test.fr')
        Membre.objects.create(utilisateur=self.divine, organisation=self.orga, role=Membre.GESTIONNAIRE)
        self.evenement, _type = creer_evenement(self.orga, titre='Concert')

    def envoyer(self, fichier, alt='Affiche du concert'):
        donnees = {'image_principale': fichier}
        if alt is not None:
            donnees['image_principale_alt'] = alt
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(reverse('api_orga_image', args=[self.evenement.pk]), donnees, headers=en_tete_auth(self.divine))

    def test_envoyer_une_image(self):
        reponse = self.envoyer(creer_image(largeur=1200, hauteur=800))
        self.assertEqual(reponse.status_code, 200)
        image = reponse.json()['image']
        self.assertEqual((image['alt'], image['width'], image['height']), ('Affiche du concert', 1200, 800))
        self.assertTrue(image['url'].startswith('http://testserver/'))   # adresse complète : l'application n'a pas à la deviner
        self.assertTrue(image['url'].endswith('-800w.webp'))
        self.assertEqual([s['width'] for s in image['sources']], [320, 800, 1200])   # jamais plus large que l'original
        self.assertTrue(all(s['url'].startswith('http://testserver/') for s in image['sources']))
        self.evenement.refresh_from_db()
        self.assertTrue(self.existe(self.evenement.image_principale.name))

    def test_l_image_est_dans_l_api_publique(self):
        self.envoyer(creer_image())
        liste = self.client.get(reverse('api_v1_evenements')).json()['results'][0]
        detail = self.client.get(reverse('api_v1_evenement', args=[self.evenement.pk])).json()
        self.assertEqual(liste['image']['alt'], 'Affiche du concert')
        self.assertEqual(detail['image'], liste['image'])

    def test_sans_image_le_champ_vaut_null(self):
        self.assertIsNone(self.client.get(reverse('api_v1_evenement', args=[self.evenement.pk])).json()['image'])

    def test_remplacer_l_image_supprime_l_ancienne_et_ses_versions(self):
        self.envoyer(creer_image('premiere.jpg'))
        self.evenement.refresh_from_db()
        ancien = self.evenement.image_principale.name
        self.assertTrue(self.existe(ancien))
        self.envoyer(creer_image('seconde.jpg', couleur=(10, 200, 50)))
        self.assertFalse(self.existe(ancien))
        self.assertFalse(self.existe(ancien.rsplit('.', 1)[0] + '-800w.webp'))

    def test_supprimer_l_image(self):
        self.envoyer(creer_image())
        self.evenement.refresh_from_db()
        nom = self.evenement.image_principale.name
        with self.captureOnCommitCallbacks(execute=True):
            reponse = self.client.delete(reverse('api_orga_image', args=[self.evenement.pk]), headers=en_tete_auth(self.divine))
        self.assertEqual(reponse.status_code, 204)
        self.evenement.refresh_from_db()
        self.assertFalse(self.evenement.image_principale)
        self.assertEqual(self.evenement.image_principale_alt, '')
        self.assertFalse(self.existe(nom))

    def test_texte_alternatif_obligatoire(self):
        for alt in (None, '', '   '):
            with self.subTest(alt=alt):
                reponse = self.envoyer(creer_image(), alt=alt)
                self.assertEqual(reponse.status_code, 400)
                self.assertIn('alt', reponse.json()['fields'])
        self.evenement.refresh_from_db()
        self.assertFalse(self.evenement.image_principale)

    def test_fichier_refuse(self):
        trop_petite = self.envoyer(creer_image(largeur=200, hauteur=100))
        pas_une_image = self.envoyer(SimpleUploadedFile('virus.jpg', b'ceci n est pas une image', content_type='image/jpeg'))
        for reponse in (trop_petite, pas_une_image):
            self.assertEqual(reponse.status_code, 400)
            self.assertIn('image', reponse.json()['fields'])
        self.evenement.refresh_from_db()
        self.assertFalse(self.evenement.image_principale)

    def test_connexion_requise(self):
        self.assertEqual(self.client.post(reverse('api_orga_image', args=[self.evenement.pk]), {}).status_code, 401)
