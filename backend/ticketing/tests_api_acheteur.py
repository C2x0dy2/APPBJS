"""
Tests de l'API de l'acheteur (api_acheteur.py) : ses billets, ses réservations en cours, réserver des places.
Chaque test crée ses propres données avec les fabriques.
"""
from datetime import timedelta

from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from . import services
from .fabriques import creer_evenement, creer_utilisateur, en_tete_auth
from .models import Billet, Commande, TypePlace

HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


def acheter(evenement, type_place, utilisateur=None, email=None, quantite=1, nom_paiement='evt'):
    """Une commande PAYÉE (donc avec ses billets) ; liée au compte `utilisateur` si on le donne."""
    commande = services.reserver(evenement, email or utilisateur.email, [(type_place.id, quantite)], utilisateur=utilisateur)
    services.confirmer_paiement(f'{nom_paiement}-{commande.pk}', commande.pk, commande.total_centimes)
    return commande


@HACHAGE_RAPIDE
class MesBilletsApiTests(TestCase):
    def setUp(self):
        self.anna = creer_utilisateur('anna@test.fr', nom_utilisateur='anna', email_verifie=True)
        self.bob = creer_utilisateur('bob@test.fr', nom_utilisateur='bob', email_verifie=True)
        self.evenement, self.type_place = creer_evenement(titre='Concert', capacite=20, prix=2000, jours=10, nom_place='Fosse')

    def lister(self, utilisateur=None):
        return self.client.get(reverse('api_mes_billets'), headers=en_tete_auth(utilisateur) if utilisateur else {})

    def test_reserve_aux_comptes_connectes(self):
        self.assertEqual(self.lister().status_code, 401)
        self.assertEqual(self.client.get(reverse('api_mon_billet', args=[1])).status_code, 401)

    def test_aucun_billet(self):
        self.assertEqual(self.lister(self.anna).json(), {'results': []})

    def test_forme_d_un_billet(self):
        acheter(self.evenement, self.type_place, self.anna, quantite=2)
        resultats = self.lister(self.anna).json()['results']
        self.assertEqual(len(resultats), 2)
        premier = resultats[0]
        self.assertEqual(set(premier), {'ticket', 'event', 'ticketType'})
        billet = Billet.objects.order_by('numero').first()
        self.assertEqual(premier['ticket'], {
            'id': str(billet.pk), 'eventId': str(self.evenement.pk), 'ticketTypeId': str(self.type_place.pk),
            'orderId': str(billet.commande_id), 'code': billet.code, 'status': 'valid'})
        self.assertEqual((premier['event']['name'], premier['event']['status']), ('Concert', 'on_sale'))
        self.assertEqual((premier['ticketType']['name'], premier['ticketType']['price']), ('Fosse', 20))
        self.assertNotIn('sold', premier['ticketType'])   # les ventes ne sont pas pour l'acheteur

    def test_un_billet_utilise_ou_annule(self):
        acheter(self.evenement, self.type_place, self.anna, quantite=2)
        utilise, annule = Billet.objects.order_by('numero')
        instant = timezone.now()
        Billet.objects.filter(pk=utilise.pk).update(statut=Billet.UTILISE, utilise_le=instant)
        Billet.objects.filter(pk=annule.pk).update(statut=Billet.ANNULE)
        par_id = {r['ticket']['id']: r['ticket'] for r in self.lister(self.anna).json()['results']}
        self.assertEqual(par_id[str(utilise.pk)]['status'], 'used')
        self.assertTrue(par_id[str(utilise.pk)]['usedAt'].endswith('Z'))
        self.assertEqual(par_id[str(annule.pk)]['status'], 'canceled')
        self.assertNotIn('usedAt', par_id[str(annule.pk)])

    def test_chacun_ne_voit_que_ses_billets(self):
        acheter(self.evenement, self.type_place, self.anna)
        acheter(self.evenement, self.type_place, self.bob)
        self.assertEqual(len(self.lister(self.anna).json()['results']), 1)
        codes_anna = {r['ticket']['code'] for r in self.lister(self.anna).json()['results']}
        codes_bob = {r['ticket']['code'] for r in self.lister(self.bob).json()['results']}
        self.assertFalse(codes_anna & codes_bob)

    def test_une_commande_passee_avec_l_adresse_du_compte_est_retrouvee_si_l_adresse_est_verifiee(self):
        acheter(self.evenement, self.type_place, utilisateur=None, email='ANNA@test.fr')   # commande passée sans compte
        self.assertEqual(len(self.lister(self.anna).json()['results']), 1)

    def test_une_adresse_non_verifiee_ne_donne_acces_a_aucun_billet(self):
        """Sinon quelqu'un pourrait ouvrir un compte avec l'adresse d'un autre pour lire ses billets."""
        acheter(self.evenement, self.type_place, utilisateur=None, email='intrus@test.fr')
        intrus = creer_utilisateur('intrus@test.fr', nom_utilisateur='intrus', email_verifie=False)
        self.assertEqual(self.lister(intrus).json(), {'results': []})
        # elle les voit dès qu'elle l'a vérifiée
        intrus.email_verifie = True
        intrus.save()
        self.assertEqual(len(self.lister(intrus).json()['results']), 1)

    def test_les_evenements_les_plus_proches_d_abord(self):
        loin, type_loin = creer_evenement(titre='Loin', jours=40)
        proche, type_proche = creer_evenement(titre='Proche', jours=3)
        for ev, tp in ((loin, type_loin), (self.evenement, self.type_place), (proche, type_proche)):
            acheter(ev, tp, self.anna)
        self.assertEqual([r['event']['name'] for r in self.lister(self.anna).json()['results']], ['Proche', 'Concert', 'Loin'])

    def test_un_evenement_annule_garde_ses_billets_visibles_avec_le_statut_annule(self):
        acheter(self.evenement, self.type_place, self.anna)
        services.annuler_evenement(self.evenement)
        resultat = self.lister(self.anna).json()['results'][0]
        self.assertEqual((resultat['ticket']['status'], resultat['event']['status']), ('canceled', 'canceled'))

    def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_de_billets(self):
        acheter(self.evenement, self.type_place, self.anna)
        with CaptureQueriesContext(connection) as un:
            self.lister(self.anna)
        autre, type_autre = creer_evenement(titre='Autre', jours=5)
        acheter(autre, type_autre, self.anna, quantite=4)
        acheter(self.evenement, self.type_place, self.anna, quantite=3)
        with CaptureQueriesContext(connection) as huit:
            reponse = self.lister(self.anna)
        self.assertEqual(len(reponse.json()['results']), 8)
        self.assertEqual(len(un), len(huit))

    # -- un seul billet
    def test_detail_d_un_billet(self):
        acheter(self.evenement, self.type_place, self.anna)
        billet = Billet.objects.get()
        corps = self.client.get(reverse('api_mon_billet', args=[billet.pk]), headers=en_tete_auth(self.anna)).json()
        self.assertEqual((corps['ticket']['code'], corps['event']['name']), (billet.code, 'Concert'))

    def test_le_billet_d_un_autre_compte_est_introuvable_comme_un_billet_inexistant(self):
        acheter(self.evenement, self.type_place, self.bob)
        billet = Billet.objects.get()
        reponses = [self.client.get(reverse('api_mon_billet', args=[ident]), headers=en_tete_auth(self.anna))
                    for ident in (billet.pk, 999999, 'abc', '٣')]
        self.assertEqual({r.status_code for r in reponses}, {404})
        self.assertEqual(len({r.content for r in reponses}), 1)   # indiscernables
        self.assertNotIn(billet.code, reponses[0].content.decode())


@HACHAGE_RAPIDE
class MesReservationsApiTests(TestCase):
    def setUp(self):
        self.anna = creer_utilisateur('anna@test.fr', nom_utilisateur='anna', email_verifie=True)
        self.bob = creer_utilisateur('bob@test.fr', nom_utilisateur='bob', email_verifie=True)
        self.evenement, self.type_place = creer_evenement(titre='Concert', capacite=10, prix=2000, nom_place='Fosse')

    def lister(self, utilisateur):
        return self.client.get(reverse('api_mes_reservations'), headers=en_tete_auth(utilisateur))

    def test_reserve_aux_comptes_connectes(self):
        self.assertEqual(self.client.get(reverse('api_mes_reservations')).status_code, 401)

    def test_une_reservation_en_cours(self):
        commande = services.reserver(self.evenement, 'anna@test.fr', [(self.type_place.id, 2)], utilisateur=self.anna)
        corps = self.lister(self.anna).json()['results'][0]
        self.assertEqual(corps['order']['id'], str(commande.pk))
        self.assertEqual(corps['order']['lines'], [{'ticketTypeId': str(self.type_place.pk), 'quantity': 2}])
        self.assertEqual((corps['order']['paymentMethod'], corps['total']), ('card', 40))
        self.assertEqual(corps['lines'][0]['unitPrice'], 20)
        self.assertEqual(corps['event']['name'], 'Concert')

    def test_les_reservations_d_un_autre_compte_et_les_commandes_payees_ou_expirees_n_apparaissent_pas(self):
        services.reserver(self.evenement, 'bob@test.fr', [(self.type_place.id, 1)], utilisateur=self.bob)
        acheter(self.evenement, self.type_place, self.anna)   # payée
        services.reserver(self.evenement, 'anna@test.fr', [(self.type_place.id, 1)], utilisateur=self.anna,
                          maintenant=timezone.now() - timedelta(hours=3))   # déjà échue
        self.assertEqual(self.lister(self.anna).json(), {'results': []})

    def test_consulter_ses_reservations_libere_les_places_des_reservations_echues(self):
        services.reserver(self.evenement, 'anna@test.fr', [(self.type_place.id, 10)], utilisateur=self.anna,
                          maintenant=timezone.now() - timedelta(hours=3))
        self.assertEqual(TypePlace.objects.get(pk=self.type_place.pk).retenues, 10)
        self.lister(self.anna)
        self.assertEqual(TypePlace.objects.get(pk=self.type_place.pk).retenues, 0)

    def test_la_plus_pressee_d_abord(self):
        autre, type_autre = creer_evenement(titre='Autre')
        services.reserver(autre, 'anna@test.fr', [(type_autre.id, 1)], 'virement', utilisateur=self.anna)   # 48 h
        services.reserver(self.evenement, 'anna@test.fr', [(self.type_place.id, 1)], 'carte', utilisateur=self.anna)   # 15 min
        self.assertEqual([r['event']['name'] for r in self.lister(self.anna).json()['results']], ['Concert', 'Autre'])


@HACHAGE_RAPIDE
class ReserverApiTests(TestCase):
    def setUp(self):
        self.anna = creer_utilisateur('anna@test.fr', nom_utilisateur='anna', email_verifie=True)
        self.evenement, self.type_place = creer_evenement(titre='Concert', capacite=5, prix=2000, nom_place='Fosse')
        self.vip = TypePlace.objects.create(evenement=self.evenement, nom='VIP', capacite=2, prix_base_centimes=5000)

    def reserver(self, corps=None, utilisateur=None, evenement=None, **extra):
        utilisateur = utilisateur or self.anna
        corps = {'items': [{'ticketTypeId': str(self.type_place.pk), 'quantity': 2}]} if corps is None else corps
        return self.client.post(reverse('api_reserver', args=[(evenement or self.evenement).pk]), corps, content_type='application/json',
                                headers=en_tete_auth(utilisateur), **extra)

    def test_reservation_reussie(self):
        reponse = self.reserver()
        self.assertEqual(reponse.status_code, 201)
        corps = reponse.json()
        self.assertEqual((corps['total'], corps['order']['paymentMethod']), (40, 'card'))
        self.assertEqual(corps['lines'][0]['quantity'], 2)
        commande = Commande.objects.get()
        self.assertEqual((commande.utilisateur, commande.email, commande.statut), (self.anna, 'anna@test.fr', Commande.EN_ATTENTE))
        self.assertEqual(TypePlace.objects.get(pk=self.type_place.pk).retenues, 2)   # les places sont bloquées
        attendu = timezone.now() + timedelta(minutes=15)
        self.assertLess(abs(commande.expire_le - attendu), timedelta(minutes=1))

    def test_plusieurs_types_et_virement(self):
        reponse = self.reserver({'paymentMethod': 'transfer', 'items': [
            {'ticketTypeId': str(self.type_place.pk), 'quantity': 1}, {'ticketTypeId': str(self.vip.pk), 'quantity': 2}]})
        self.assertEqual(reponse.status_code, 201)
        self.assertEqual(reponse.json()['total'], 20 + 100)
        self.assertEqual(reponse.json()['order']['paymentMethod'], 'transfer')
        self.assertLess(abs(Commande.objects.get().expire_le - (timezone.now() + timedelta(hours=48))), timedelta(minutes=1))

    def test_le_prix_est_figé_a_la_reservation(self):
        self.reserver()
        TypePlace.objects.filter(pk=self.type_place.pk).update(prix_base_centimes=9900)
        self.assertEqual(Commande.objects.get().total_centimes, 4000)

    def test_reserve_aux_comptes_connectes_et_verifies(self):
        sans_jeton = self.client.post(reverse('api_reserver', args=[self.evenement.pk]), {'items': []}, content_type='application/json')
        self.assertEqual(sans_jeton.status_code, 401)
        non_verifie = creer_utilisateur('nv@test.fr', nom_utilisateur='nv', email_verifie=False)
        reponse = self.reserver(utilisateur=non_verifie)
        self.assertEqual((reponse.status_code, reponse.json()['error']), (403, 'email_not_verified'))
        self.assertFalse(Commande.objects.exists())

    def test_plus_de_places_renvoie_409_sans_rien_retenir(self):
        reponse = self.reserver({'items': [{'ticketTypeId': str(self.type_place.pk), 'quantity': 3},
                                           {'ticketTypeId': str(self.vip.pk), 'quantity': 3}]})   # 3 VIP demandées, il n'y en a que 2
        corps = reponse.json()
        self.assertEqual((reponse.status_code, corps['error'], corps['ticketTypeId']), (409, 'sold_out', str(self.vip.pk)))
        self.assertEqual(TypePlace.objects.get(pk=self.type_place.pk).retenues, 0)   # la transaction a tout annulé
        self.assertFalse(Commande.objects.exists())

    def test_complet_apres_une_autre_reservation(self):
        autre = creer_utilisateur('autre@test.fr', nom_utilisateur='autre', email_verifie=True)
        self.assertEqual(self.reserver({'items': [{'ticketTypeId': str(self.type_place.pk), 'quantity': 5}]}, utilisateur=autre).status_code, 201)
        self.assertEqual(self.reserver().status_code, 409)

    def test_les_places_d_une_reservation_expiree_sont_rendues_avant_de_reserver(self):
        autre = creer_utilisateur('autre@test.fr', nom_utilisateur='autre', email_verifie=True)
        services.reserver(self.evenement, 'autre@test.fr', [(self.type_place.id, 5)], utilisateur=autre, maintenant=timezone.now() - timedelta(hours=3))
        self.assertEqual(self.reserver().status_code, 201)

    def test_validation(self):
        id_place = str(self.type_place.pk)
        cas = {
            'pas de place': {'items': []},
            'items absent': {},
            'items pas une liste': {'items': 'x'},
            'place inconnue': {'items': [{'ticketTypeId': '999999', 'quantity': 1}]},
            'place d\'un autre événement': {'items': [{'ticketTypeId': str(creer_evenement(titre='Autre')[1].pk), 'quantity': 1}]},
            'quantité nulle': {'items': [{'ticketTypeId': id_place, 'quantity': 0}]},
            'quantité négative': {'items': [{'ticketTypeId': id_place, 'quantity': -2}]},
            'quantité texte': {'items': [{'ticketTypeId': id_place, 'quantity': '2'}]},
            'quantité booléenne': {'items': [{'ticketTypeId': id_place, 'quantity': True}]},
            'ligne illisible': {'items': ['x']},
            'moyen inconnu': {'paymentMethod': 'cheque', 'items': [{'ticketTypeId': id_place, 'quantity': 1}]},
        }
        for nom, corps in cas.items():
            with self.subTest(nom):
                reponse = self.reserver(corps)
                self.assertEqual((reponse.status_code, reponse.json()['error']), (400, 'validation'))
        self.assertFalse(Commande.objects.exists())

    @override_settings(MAX_PLACES_PAR_COMMANDE=3)
    def test_maximum_par_commande_vient_de_la_configuration(self):
        self.assertEqual(self.reserver({'items': [{'ticketTypeId': str(self.type_place.pk), 'quantity': 4}]}).status_code, 400)
        self.assertEqual(self.reserver({'items': [{'ticketTypeId': str(self.type_place.pk), 'quantity': 3}]}).status_code, 201)

    @override_settings(COMMANDES_EN_ATTENTE_MAX=2)
    def test_limite_de_reservations_en_attente_par_compte(self):
        un = {'items': [{'ticketTypeId': str(self.type_place.pk), 'quantity': 1}]}
        self.assertEqual(self.reserver(un).status_code, 201)
        self.assertEqual(self.reserver(un).status_code, 201)
        reponse = self.reserver(un)
        self.assertEqual((reponse.status_code, reponse.json()['error']), (409, 'too_many_pending'))
        self.assertEqual(Commande.objects.count(), 2)

    def test_evenement_introuvable_brouillon_ou_annule(self):
        brouillon, type_brouillon = creer_evenement(titre='Brouillon', publie=False)
        annule, type_annule = creer_evenement(titre='Annulé')
        services.annuler_evenement(annule)
        for ev, tp in ((brouillon, type_brouillon), (annule, type_annule)):
            with self.subTest(ev.titre):
                reponse = self.reserver({'items': [{'ticketTypeId': str(tp.pk), 'quantity': 1}]}, evenement=ev)
                self.assertEqual((reponse.status_code, reponse.json()['error']), (404, 'not_found'))
        self.assertEqual(self.client.post(reverse('api_reserver', args=['abc']), {}, content_type='application/json',
                                          headers=en_tete_auth(self.anna)).status_code, 404)

    def test_evenement_deja_commence(self):
        passe, type_passe = creer_evenement(titre='Passé', jours=-1)
        reponse = self.reserver({'items': [{'ticketTypeId': str(type_passe.pk), 'quantity': 1}]}, evenement=passe)
        self.assertEqual((reponse.status_code, reponse.json()['error']), (409, 'event_over'))

    def test_seule_la_methode_post_est_acceptee(self):
        self.assertEqual(self.client.get(reverse('api_reserver', args=[self.evenement.pk]), headers=en_tete_auth(self.anna)).status_code, 405)
