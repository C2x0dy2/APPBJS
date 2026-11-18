"""
Tests de la notification de paiement du prestataire (api.py : webhook_paiement) : signature, montant, rejeu, cas limites.
Chaque test crée ses propres données avec les fabriques.
"""
import hashlib
import hmac
import json

from django.test import Client, TestCase, override_settings
from django.urls import reverse

from . import services
from .fabriques import creer_evenement
from .models import Billet, Commande, NotificationPaiement, TypePlace

SECRET = 'secret-de-test'


def envoyer(client, charge=None, secret=SECRET, signature=None, corps=None):
    """Envoie une notification comme le ferait le prestataire : signature HMAC-SHA256 du corps brut dans X-Signature."""
    corps = json.dumps(charge) if corps is None else corps
    if signature is None:
        signature = hmac.new(secret.encode(), corps.encode(), hashlib.sha256).hexdigest()
    return client.post(reverse('api_webhook_paiement'), corps, content_type='application/json', headers={'X-Signature': signature})


@override_settings(PAYMENT_WEBHOOK_SECRET=SECRET)
class WebhookPaiementTests(TestCase):
    def setUp(self):
        self.evenement, self.type_place = creer_evenement(capacite=5, prix=2000)
        self.commande = services.reserver(self.evenement, 'a@test.fr', [(self.type_place.id, 2)])   # 2 places à 20 € = 40 €

    def charge(self, **changements):
        charge = {'event_id': 'evt-1', 'order_id': self.commande.pk, 'amount_cents': self.commande.total_centimes}
        charge.update(changements)
        return charge

    def etat(self):
        """Ce qui a changé en base : (statut, à rembourser, billets émis, places vendues, places retenues)."""
        commande = Commande.objects.get(pk=self.commande.pk)
        place = TypePlace.objects.get(pk=self.type_place.pk)
        return commande.statut, commande.a_rembourser, Billet.objects.count(), place.vendues, place.retenues

    # ---------------------------------------------------------------- le chemin normal
    def test_paiement_valide_emet_les_billets(self):
        reponse = envoyer(self.client, self.charge())
        self.assertEqual((reponse.status_code, reponse.json()), (200, {'result': 'paid'}))
        self.assertEqual(self.etat(), (Commande.PAYEE, False, 2, 2, 0))

    def test_le_rejeu_de_la_meme_notification_ne_change_rien(self):
        envoyer(self.client, self.charge())
        reponse = envoyer(self.client, self.charge())
        self.assertEqual((reponse.status_code, reponse.json()), (200, {'result': 'duplicate'}))   # 200 : pas de réessai infini
        self.assertEqual(self.etat(), (Commande.PAYEE, False, 2, 2, 0))
        self.assertEqual(NotificationPaiement.objects.count(), 1)

    def test_une_autre_notification_pour_la_meme_commande_ne_change_rien(self):
        envoyer(self.client, self.charge())
        reponse = envoyer(self.client, self.charge(event_id='evt-2'))
        self.assertEqual(reponse.json(), {'result': 'duplicate'})
        self.assertEqual(self.etat(), (Commande.PAYEE, False, 2, 2, 0))

    def test_paiement_apres_l_annulation_de_l_evenement(self):
        services.annuler_evenement(self.evenement)   # l'organisateur annule pendant que l'acheteur paie
        reponse = envoyer(self.client, self.charge())
        self.assertEqual(reponse.json(), {'result': 'late'})
        statut, a_rembourser, billets, vendues, retenues = self.etat()
        self.assertEqual((a_rembourser, billets, vendues), (True, 0, 0))   # pas de billet : l'argent est à rendre

    def test_le_webhook_n_a_pas_besoin_de_la_protection_csrf(self):
        reponse = envoyer(Client(enforce_csrf_checks=True), self.charge())
        self.assertEqual(reponse.status_code, 200)

    # ---------------------------------------------------------------- signature
    def test_signature_invalide_ne_change_rien(self):
        for signature in ('0' * 64, '', 'pas-hexadecimal', 'é' * 64):   # un en-tête non ASCII doit donner 401, jamais une erreur serveur
            with self.subTest(signature=signature):
                reponse = envoyer(self.client, self.charge(), signature=signature)
                self.assertEqual(reponse.status_code, 401)
        self.assertEqual(self.etat(), (Commande.EN_ATTENTE, False, 0, 0, 2))

    def test_signature_calculee_avec_un_autre_secret(self):
        reponse = envoyer(self.client, self.charge(), secret='secret-de-quelqu-un-d-autre')
        self.assertEqual(reponse.status_code, 401)
        self.assertEqual(self.etat(), (Commande.EN_ATTENTE, False, 0, 0, 2))

    def test_la_signature_porte_sur_le_corps_exact(self):
        """Modifier le corps après la signature (ici le montant) invalide la signature."""
        corps_signe = json.dumps(self.charge())
        signature = hmac.new(SECRET.encode(), corps_signe.encode(), hashlib.sha256).hexdigest()
        corps_modifie = json.dumps(self.charge(amount_cents=1))
        self.assertEqual(envoyer(self.client, corps=corps_modifie, signature=signature).status_code, 401)

    def test_la_signature_est_verifiee_avant_tout_le_reste(self):
        """Sans le secret, on ne peut pas savoir si une commande existe : 401 dans tous les cas."""
        for charge in (self.charge(), self.charge(order_id=999999), {'n_importe': 'quoi'}):
            with self.subTest(charge=charge):
                self.assertEqual(envoyer(self.client, charge, signature='0' * 64).status_code, 401)

    def test_sans_en_tete_de_signature(self):
        reponse = self.client.post(reverse('api_webhook_paiement'), json.dumps(self.charge()), content_type='application/json')
        self.assertEqual(reponse.status_code, 401)

    @override_settings(PAYMENT_WEBHOOK_SECRET='')
    def test_paiement_non_configure_refuse_tout(self):
        """Sans secret configuré, une signature « valide » (calculée avec un secret vide) ne doit jamais être acceptée."""
        reponse = envoyer(self.client, self.charge(), secret='')
        self.assertEqual(reponse.status_code, 503)
        self.assertEqual(self.etat(), (Commande.EN_ATTENTE, False, 0, 0, 2))

    # ---------------------------------------------------------------- contenu de la notification
    def test_montant_different_de_la_commande(self):
        for montant in (1, self.commande.total_centimes - 1, self.commande.total_centimes + 1, 0):
            with self.subTest(montant=montant):
                self.assertEqual(envoyer(self.client, self.charge(amount_cents=montant)).status_code, 400)
        self.assertEqual(self.etat(), (Commande.EN_ATTENTE, False, 0, 0, 2))

    def test_commande_inconnue(self):
        for numero in (999999, 10 ** 30):   # un nombre énorme ne doit pas provoquer d'erreur serveur
            with self.subTest(numero=numero):
                self.assertEqual(envoyer(self.client, self.charge(order_id=numero)).status_code, 404)

    def test_corps_invalide(self):
        corps = [
            'ceci n est pas du json', '[]', '"texte"', '42', 'null', '{}',
            json.dumps({'event_id': 'evt-1', 'order_id': self.commande.pk}),   # montant manquant
            json.dumps({'event_id': 'evt-1', 'amount_cents': 4000}),   # commande manquante
            json.dumps({'order_id': self.commande.pk, 'amount_cents': 4000}),   # identifiant de notification manquant
            json.dumps(self.charge(order_id='abc')), json.dumps(self.charge(order_id=None)),
            json.dumps(self.charge(amount_cents='beaucoup')), json.dumps(self.charge(amount_cents=[4000])),
        ]
        for texte in corps:
            with self.subTest(corps=texte):
                self.assertEqual(envoyer(self.client, corps=texte).status_code, 400)
        self.assertEqual(self.etat(), (Commande.EN_ATTENTE, False, 0, 0, 2))

    def test_seul_post_est_accepte(self):
        for methode in ('get', 'put', 'delete'):
            with self.subTest(methode=methode):
                self.assertEqual(getattr(self.client, methode)(reverse('api_webhook_paiement')).status_code, 405)
