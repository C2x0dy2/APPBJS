"""
Tests de l'API v1 pour l'application : lecture publique (api_v1.py), format JSON (serialisation.py), CORS (cors.py) et
contrat avec les types TypeScript de l'application (src/types/).

Chaque test crée ses propres données avec les fabriques. Les dates fixes sont en 2099 : l'événement reste « à venir »
quand les tests sont rejoués dans des années, et les conversions de fuseau (heure d'été comprise) se vérifient à la main.
"""
import json
import os
import re
from datetime import datetime, time, timedelta, timezone as dt_timezone
from pathlib import Path
from unittest import mock, skipUnless

from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import connection
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone

from config import settings as reglages

from . import serialisation, services
from .fabriques import creer_evenement, creer_image, creer_organisation, creer_utilisateur, en_tete_auth, parametres
from .models import Billet, Commande, Evenement, Lieu, Membre, PageLegale, Tarif, TypePlace
from .tests_images import StockageTemporaire


def instant(annee, mois, jour, heure=0, minute=0):
    return datetime(annee, mois, jour, heure, minute, tzinfo=dt_timezone.utc)


ETE = instant(2099, 7, 15, 18, 0)   # 20:00 à Paris (heure d'été, UTC+2)


class ApiTestCase(TestCase):
    """Raccourcis : chaque méthode vérifie que la réponse est un succès et renvoie son contenu JSON."""
    url_liste = None

    def setUp(self):
        self.url_liste = reverse('api_v1_evenements')

    def liste(self):
        reponse = self.client.get(self.url_liste)
        self.assertEqual(reponse.status_code, 200)
        return reponse.json()['results']

    def fiche(self, evenement):
        reponse = self.client.get(reverse('api_v1_evenement', args=[evenement.pk]))
        self.assertEqual(reponse.status_code, 200)
        return reponse.json()

    def types(self, evenement):
        reponse = self.client.get(reverse('api_v1_types_place', args=[evenement.pk]))
        self.assertEqual(reponse.status_code, 200)
        return reponse.json()['results']


# ======================================================================================
# Événements
# ======================================================================================
class EvenementsApiTests(ApiTestCase):
    def test_reponse_json(self):
        creer_evenement()
        reponse = self.client.get(self.url_liste)
        self.assertEqual(reponse['Content-Type'], 'application/json')

    def test_forme_complete_d_un_evenement(self):
        orga = creer_organisation('Collectif Bordeaux')
        lieu = Lieu.objects.create(nom='La Rock School Barbey', ville='Bordeaux')
        evenement, _type = creer_evenement(orga, titre='Soirée Électro', debut=ETE, fuseau_horaire='Europe/Paris',
                                           lieu=lieu, ouverture_portes=time(19, 30))
        self.assertEqual(self.fiche(evenement), {
            'id': str(evenement.pk), 'collectiveId': str(orga.pk), 'name': 'Soirée Électro',
            'location': 'La Rock School Barbey, Bordeaux', 'date': '2099-07-15', 'startTime': '20:00',
            'doorsOpenTime': '19:30', 'timezone': 'Europe/Paris', 'currency': 'EUR',
            'cancellationDeadline': '2099-07-14', 'status': 'on_sale',
            'slug': evenement.slug, 'isOnline': False, 'collectiveName': 'Collectif Bordeaux',
            'startsAt': '2099-07-15T18:00:00Z', 'cancellationDeadlineAt': '2099-07-14T18:00:00Z',
            'fromPrice': 20, 'image': None,
        })

    def test_les_identifiants_sont_du_texte(self):
        """L'application compare ses identifiants avec `===` : un nombre ne serait jamais égal à un texte."""
        evenement, type_place = creer_evenement()
        fiche = self.fiche(evenement)
        self.assertIsInstance(fiche['id'], str)
        self.assertIsInstance(fiche['collectiveId'], str)
        self.assertIsInstance(self.types(evenement)[0]['id'], str)
        self.assertIsInstance(self.types(evenement)[0]['eventId'], str)

    def test_les_horaires_sont_ceux_du_fuseau_de_l_evenement(self):
        cas = [
            # (fuseau, instant UTC, jour local, heure locale)
            ('Europe/Paris', instant(2099, 7, 15, 18, 0), '2099-07-15', '20:00'),        # heure d'été : UTC+2
            ('Europe/Paris', instant(2099, 12, 15, 19, 0), '2099-12-15', '20:00'),       # heure d'hiver : UTC+1
            ('America/Martinique', instant(2099, 7, 15, 2, 30), '2099-07-14', '22:30'),  # la veille en Martinique (UTC-4)
            ('Asia/Tokyo', instant(2099, 7, 15, 20, 0), '2099-07-16', '05:00'),          # le lendemain à Tokyo (UTC+9)
        ]
        orga = creer_organisation()
        for fuseau, debut, jour, heure in cas:
            with self.subTest(fuseau=fuseau, debut=debut):
                evenement, _type = creer_evenement(orga, titre=f'{fuseau} {debut:%m%d%H}', debut=debut, fuseau_horaire=fuseau)
                fiche = self.fiche(evenement)
                self.assertEqual((fiche['date'], fiche['startTime'], fiche['timezone']), (jour, heure, fuseau))
                self.assertEqual(fiche['startsAt'], debut.strftime('%Y-%m-%dT%H:%M:%SZ'))   # l'instant exact, lui, ne change pas

    def test_lieu_physique_en_ligne_ou_absent(self):
        orga = creer_organisation()
        lieu = Lieu.objects.create(nom='Le Rocher de Palmer', ville='Cenon')
        cas = {
            'physique': ({'lieu': lieu}, 'Le Rocher de Palmer, Cenon', False),
            'en ligne': ({'est_en_ligne': True}, 'En ligne', True),
            'en ligne malgré un lieu': ({'est_en_ligne': True, 'lieu': lieu}, 'En ligne', True),
            'sans lieu': ({}, '', False),   # rien d'inventé quand rien n'est renseigné
        }
        for nom, (extra, libelle, en_ligne) in cas.items():
            with self.subTest(nom):
                evenement, _type = creer_evenement(orga, titre=nom, **extra)
                fiche = self.fiche(evenement)
                self.assertEqual((fiche['location'], fiche['isOnline']), (libelle, en_ligne))

    def test_heure_d_ouverture_des_portes_absente_vaut_null(self):
        evenement, _type = creer_evenement()
        fiche = self.fiche(evenement)
        self.assertIn('doorsOpenTime', fiche)
        self.assertIsNone(fiche['doorsOpenTime'])

    def test_prix_des_est_le_plus_bas_des_prix_en_vigueur(self):
        evenement, fosse = creer_evenement(prix=2500, nom_place='Fosse')
        TypePlace.objects.create(evenement=evenement, nom='Balcon', capacite=10, prix_base_centimes=4000)
        self.assertEqual(self.fiche(evenement)['fromPrice'], 25)
        # le tarif early compte tant qu'il est valable, et les centimes sont gardés
        tarif = Tarif.objects.create(type_place=fosse, prix_centimes=1550, valide_jusqua=timezone.now() + timedelta(days=2))
        self.assertEqual(self.fiche(evenement)['fromPrice'], 15.5)
        Tarif.objects.filter(pk=tarif.pk).update(valide_jusqua=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.fiche(evenement)['fromPrice'], 25)   # échu : le prix normal reprend
        TypePlace.objects.create(evenement=evenement, nom='Invitation', capacite=5, prix_base_centimes=0)
        self.assertEqual(self.fiche(evenement)['fromPrice'], 0)   # une place gratuite : « dès 0 »

    def test_prix_des_est_null_sans_type_de_place(self):
        evenement, type_place = creer_evenement()
        type_place.delete()
        self.assertIsNone(self.fiche(evenement)['fromPrice'])

    def test_un_evenement_annule_n_existe_plus_pour_le_public(self):
        orga = creer_organisation()
        visible, _type = creer_evenement(orga, titre='Visible', jours=5)
        annule, _type = creer_evenement(orga, titre='Annulé', jours=6, annule=True)
        self.assertEqual([e['id'] for e in self.liste()], [str(visible.pk)])
        for route in ('api_v1_evenement', 'api_v1_types_place'):
            self.assertEqual(self.client.get(reverse(route, args=[annule.pk])).status_code, 404)

    def test_la_lecture_libere_les_reservations_expirees(self):
        """Sans tâche planifiée, une réservation abandonnée ne doit pas bloquer des places pour toujours."""
        evenement, type_place = creer_evenement(capacite=2)
        services.reserver(evenement, 'a@test.fr', [(type_place.id, 2)], maintenant=timezone.now() - timedelta(hours=1))
        self.assertEqual(TypePlace.objects.get(pk=type_place.pk).retenues, 2)   # échue, mais encore comptée
        self.assertFalse(self.types(evenement)[0]['soldOut'])
        self.assertEqual(TypePlace.objects.get(pk=type_place.pk).retenues, 0)
        self.assertEqual(self.fiche(evenement)['status'], 'on_sale')

    def test_une_reservation_en_cours_garde_ses_places(self):
        evenement, type_place = creer_evenement(capacite=2)
        services.reserver(evenement, 'a@test.fr', [(type_place.id, 2)])   # 15 minutes devant elle
        self.assertTrue(self.types(evenement)[0]['soldOut'])
        self.assertEqual(self.fiche(evenement)['status'], 'sold_out')

    def test_monnaie_de_l_evenement(self):
        with override_settings(DEVISE_PAR_DEFAUT='EUR'):
            par_defaut, _type = creer_evenement(titre='Par défaut')
        en_xof, _type = creer_evenement(titre='Live', devise='XOF')
        self.assertEqual(self.fiche(par_defaut)['currency'], 'EUR')
        self.assertEqual(self.fiche(en_xof)['currency'], 'XOF')

    def test_date_limite_d_annulation(self):
        orga = creer_organisation()
        explicite, _type = creer_evenement(orga, titre='Explicite', debut=ETE, fuseau_horaire='Europe/Paris',
                                           date_limite_annulation=instant(2099, 7, 10, 23, 30))
        defaut, _type = creer_evenement(orga, titre='Défaut', debut=ETE, fuseau_horaire='Europe/Paris')
        # 23:30 UTC = 01:30 à Paris le lendemain : le JOUR indiqué est celui du fuseau de l'événement
        fiche = self.fiche(explicite)
        self.assertEqual((fiche['cancellationDeadline'], fiche['cancellationDeadlineAt']), ('2099-07-11', '2099-07-10T23:30:00Z'))
        # sans date propre : le délai par défaut des paramètres du site (24 h)
        self.assertEqual(self.fiche(defaut)['cancellationDeadlineAt'], '2099-07-14T18:00:00Z')
        parametres(delai_annulation_defaut_heures=48)
        fiche = self.fiche(defaut)
        self.assertEqual((fiche['cancellationDeadline'], fiche['cancellationDeadlineAt']), ('2099-07-13', '2099-07-13T18:00:00Z'))

    def test_statut_selon_la_situation(self):
        orga = creer_organisation()
        en_vente, _type = creer_evenement(orga, titre='En vente')
        complet, type_complet = creer_evenement(orga, titre='Complet', capacite=5)
        TypePlace.objects.filter(pk=type_complet.pk).update(vendues=3, retenues=2)   # rien à acheter, réservations en cours comprises
        un_type_plein, type_plein = creer_evenement(orga, titre='Un type plein', capacite=5)
        TypePlace.objects.filter(pk=type_plein.pk).update(vendues=5)
        TypePlace.objects.create(evenement=un_type_plein, nom='Autre', capacite=10, prix_base_centimes=1000)   # il reste une catégorie
        sans_type, type_inutile = creer_evenement(orga, titre='Sans type de place')
        type_inutile.delete()
        termine, _type = creer_evenement(orga, titre='Terminé', jours=-2)
        brouillon, _type = creer_evenement(orga, titre='Brouillon', publie=False)

        attendus = [(en_vente, 'on_sale'), (complet, 'sold_out'), (un_type_plein, 'on_sale'), (sans_type, 'on_sale'),
                    (termine, 'finished')]
        for evenement, statut in attendus:
            with self.subTest(evenement.titre):
                self.assertEqual(self.fiche(evenement)['status'], statut)
        # Le brouillon n'a pas de statut public : il n'existe pas pour l'API (voir le test d'indiscernabilité).
        self.assertEqual(self.client.get(reverse('api_v1_evenement', args=[brouillon.pk])).status_code, 404)

    def test_la_liste_ne_montre_que_les_evenements_publies_a_venir_du_plus_proche_au_plus_lointain(self):
        orga = creer_organisation()
        loin, _type = creer_evenement(orga, titre='Loin', jours=20)
        proche, _type = creer_evenement(orga, titre='Proche', jours=3)
        milieu, _type = creer_evenement(orga, titre='Milieu', jours=10)
        creer_evenement(orga, titre='Brouillon', jours=5, publie=False)
        creer_evenement(orga, titre='Passé', jours=-5)
        self.assertEqual([e['id'] for e in self.liste()], [str(proche.pk), str(milieu.pk), str(loin.pk)])

    def test_la_liste_est_vide_quand_il_n_y_a_rien(self):
        self.assertEqual(self.liste(), [])

    def test_le_public_voit_les_evenements_de_tous_les_collectifs_chacun_identifie(self):
        evenement_a, _type = creer_evenement(creer_organisation('Collectif A'), titre='Soirée A', jours=3)
        evenement_b, _type = creer_evenement(creer_organisation('Collectif B'), titre='Soirée B', jours=4)
        par_id = {e['id']: e for e in self.liste()}
        self.assertEqual(par_id[str(evenement_a.pk)]['collectiveName'], 'Collectif A')
        self.assertEqual(par_id[str(evenement_b.pk)]['collectiveName'], 'Collectif B')
        self.assertNotEqual(par_id[str(evenement_a.pk)]['collectiveId'], par_id[str(evenement_b.pk)]['collectiveId'])

    def test_inconnu_brouillon_annule_ou_identifiant_invalide_donnent_la_meme_reponse(self):
        """On ne révèle pas qu'un événement non publié (ou annulé) existe."""
        brouillon, _type = creer_evenement(titre='Brouillon', publie=False)
        annule, _type = creer_evenement(titre='Annulé', annule=True)
        identifiants = [str(brouillon.pk), str(annule.pk), '999999', 'abc', '3_0', '٣', '9' * 40, '0']
        for route in ('api_v1_evenement', 'api_v1_types_place'):
            corps = set()
            for identifiant in identifiants:
                with self.subTest(route=route, identifiant=identifiant):
                    reponse = self.client.get(reverse(route, args=[identifiant]))
                    self.assertEqual(reponse.status_code, 404)
                    self.assertEqual(reponse['Content-Type'], 'application/json')
                    self.assertEqual(reponse.json()['error'], 'not_found')
                    corps.add(reponse.content)
            self.assertEqual(len(corps), 1)

    def test_seule_la_lecture_est_acceptee(self):
        evenement, _type = creer_evenement()
        urls = [self.url_liste, reverse('api_v1_evenement', args=[evenement.pk]), reverse('api_v1_types_place', args=[evenement.pk])]
        for url in urls:
            for methode in ('post', 'put', 'patch', 'delete'):
                with self.subTest(url=url, methode=methode):
                    self.assertEqual(getattr(self.client, methode)(url).status_code, 405)

    def test_une_ecriture_refusee_repond_405_meme_avec_la_verification_csrf_active(self):
        """Le client de test ignore le CSRF par défaut, un vrai navigateur ou une vraie application non : sans exemption,
        la réponse serait la page HTML « Page expirée » (403) au lieu d'un refus clair."""
        evenement, _type = creer_evenement()
        client = Client(enforce_csrf_checks=True)
        for url in (self.url_liste, reverse('api_v1_evenement', args=[evenement.pk]), reverse('api_v1_types_place', args=[evenement.pk])):
            with self.subTest(url=url):
                reponse = client.post(url)
                self.assertEqual(reponse.status_code, 405)
                self.assertNotContains(reponse, 'Page expirée', status_code=405)

    def test_adresse_inconnue_repond_en_json(self):
        for chemin in ('/api/v1/', '/api/v1/inexistant/', '/api/v1/events', '/api/v1/events/1/ticket-types/en-trop/'):
            with self.subTest(chemin=chemin):
                reponse = self.client.get(chemin)
                self.assertEqual(reponse.status_code, 404)
                self.assertEqual(reponse['Content-Type'], 'application/json')
                self.assertEqual(reponse.json()['error'], 'not_found')

    def requetes(self, url):
        with CaptureQueriesContext(connection) as capture:
            reponse = self.client.get(url)
        self.assertEqual(reponse.status_code, 200)
        return len(capture)

    def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_d_evenements(self):
        orga = creer_organisation()
        lieu = Lieu.objects.create(nom='Salle', ville='Bordeaux')
        creer_evenement(orga, titre='Un seul', lieu=lieu)
        pour_un = self.requetes(self.url_liste)
        for i in range(5):
            _evenement, type_place = creer_evenement(orga, titre=f'Autre {i}', lieu=lieu, jours=2 + i)
            Tarif.objects.create(type_place=type_place, prix_centimes=1000, valide_jusqua=timezone.now() + timedelta(days=1))
        pour_six = self.requetes(self.url_liste)
        self.assertEqual(pour_un, pour_six)
        # 5 requêtes : libération des réservations expirées, réglages du site, événements, types de place, tarifs
        self.assertLessEqual(pour_six, 5)

    def test_le_nombre_de_requetes_de_la_fiche_et_des_types_ne_depend_pas_du_nombre_de_types(self):
        evenement, _type = creer_evenement()
        url_fiche = reverse('api_v1_evenement', args=[evenement.pk])
        url_types = reverse('api_v1_types_place', args=[evenement.pk])
        avant = (self.requetes(url_fiche), self.requetes(url_types))
        for i in range(5):
            type_place = TypePlace.objects.create(evenement=evenement, nom=f'Type {i}', capacite=10, prix_base_centimes=1000)
            Tarif.objects.create(type_place=type_place, prix_centimes=500, valide_jusqua=timezone.now() + timedelta(days=1))
        apres = (self.requetes(url_fiche), self.requetes(url_types))
        self.assertEqual(avant, apres)
        self.assertLessEqual(max(apres), 5)   # mêmes 5 requêtes que la liste, quel que soit le nombre de types


# ======================================================================================
# Types de place
# ======================================================================================
class TypesPlaceApiTests(ApiTestCase):
    def test_forme_d_un_type_de_place_sans_tarif_early(self):
        evenement, type_place = creer_evenement(capacite=400, prix=2000, nom_place='Fosse')
        TypePlace.objects.filter(pk=type_place.pk).update(vendues=12, retenues=3)
        # égalité exacte : ni earlyPrice ni earlyPriceDeadline (absents, et non null), ni compteur de ventes
        self.assertEqual(self.types(evenement), [{
            'id': str(type_place.pk), 'eventId': str(evenement.pk), 'name': 'Fosse', 'price': 20, 'quantity': 400,
            'currentPrice': 20, 'remaining': None, 'soldOut': False,   # 385 places libres sur 400 : le nombre exact n'est pas public
        }])

    def test_montants_en_unites_de_la_monnaie(self):
        # (centièmes stockés, montant rendu) : 500000 centièmes de XOF = 5 000 XOF
        for centimes, attendu in [(2000, 20), (1550, 15.5), (1999, 19.99), (5, 0.05), (0, 0), (500000, 5000)]:
            with self.subTest(centimes=centimes):
                evenement, _type = creer_evenement(titre=f'Prix {centimes}', prix=centimes)
                prix = self.types(evenement)[0]['price']
                self.assertEqual(prix, attendu)
                self.assertNotIsInstance(prix, bool)
                self.assertIsInstance(prix, (int, float))   # un nombre, pas un texte

    def test_tarif_early_en_cours(self):
        evenement, type_place = creer_evenement(debut=ETE, fuseau_horaire='Europe/Paris', prix=2000)
        # 23:30 UTC le 1er mars = 00:30 à Paris le 2 mars : l'application lit le jour dans le fuseau de l'événement
        Tarif.objects.create(type_place=type_place, prix_centimes=1500, valide_jusqua=instant(2099, 3, 1, 23, 30))
        type_ = self.types(evenement)[0]
        self.assertEqual((type_['price'], type_['earlyPrice'], type_['earlyPriceDeadline'], type_['currentPrice']),
                         (20, 15, '2099-03-02', 15))

    def test_tarif_early_expire_disparait(self):
        evenement, type_place = creer_evenement(prix=2000)
        Tarif.objects.create(type_place=type_place, prix_centimes=1500, valide_jusqua=timezone.now() - timedelta(hours=1))
        type_ = self.types(evenement)[0]
        self.assertNotIn('earlyPrice', type_)
        self.assertNotIn('earlyPriceDeadline', type_)
        self.assertEqual((type_['price'], type_['currentPrice']), (20, 20))

    def test_plusieurs_tarifs_early_le_plus_proche_encore_valide_l_emporte(self):
        evenement, type_place = creer_evenement(prix=2000)
        maintenant = timezone.now()
        for prix, jours in [(1000, -1), (1500, 10), (1200, 3)]:   # un expiré, deux valides
            Tarif.objects.create(type_place=type_place, prix_centimes=prix, valide_jusqua=maintenant + timedelta(days=jours))
        type_ = self.types(evenement)[0]
        self.assertEqual((type_['earlyPrice'], type_['currentPrice'], type_['price']), (12, 12, 20))

    def test_complet(self):
        evenement, type_place = creer_evenement(capacite=5)
        TypePlace.objects.filter(pk=type_place.pk).update(vendues=3, retenues=2)   # les réservations en cours comptent aussi
        type_ = self.types(evenement)[0]
        self.assertEqual((type_['quantity'], type_['remaining'], type_['soldOut']), (5, None, True))

    def test_le_nombre_exact_de_places_n_est_donne_que_sous_le_seuil_dernieres_places(self):
        """Mêmes règles que le badge « Plus que N places » du site : seuil des paramètres (20 % par défaut), strictement en dessous."""
        parametres(seuil_dernieres_places_pct=20)
        # (vendues, retenues, places restantes visibles) pour une capacité de 100
        cas = [(0, 0, None), (79, 0, None), (80, 0, None), (81, 0, 19), (75, 6, 19), (99, 0, 1), (100, 0, None)]
        for vendues, retenues, attendu in cas:
            with self.subTest(vendues=vendues, retenues=retenues):
                evenement, type_place = creer_evenement(titre=f'V{vendues}-{retenues}', capacite=100)
                TypePlace.objects.filter(pk=type_place.pk).update(vendues=vendues, retenues=retenues)
                self.assertEqual(self.types(evenement)[0]['remaining'], attendu)
        parametres(seuil_dernieres_places_pct=50)   # le réglage de l'organisateur du site est respecté
        evenement, type_place = creer_evenement(titre='Seuil à 50', capacite=100)
        TypePlace.objects.filter(pk=type_place.pk).update(vendues=60)
        self.assertEqual(self.types(evenement)[0]['remaining'], 40)

    def test_les_ventes_ne_sont_jamais_publiques(self):
        """Chiffres de vente = espace organisateur (cloisonné). L'API publique n'en donne aucun, même presque complet."""
        evenement, type_place = creer_evenement(capacite=100)
        TypePlace.objects.filter(pk=type_place.pk).update(vendues=90, retenues=4)
        reponse = self.client.get(reverse('api_v1_types_place', args=[evenement.pk]))
        type_ = reponse.json()['results'][0]
        for interdit in ('sold', 'vendues', 'sales', 'revenue', 'held', 'retenues'):
            self.assertNotIn(interdit, type_)
        self.assertEqual(type_['remaining'], 6)   # seul le « Plus que 6 places » public
        for interdit in ('sold', 'revenue', 'orders'):
            self.assertNotIn(interdit, self.fiche(evenement))

    def test_les_types_gardent_l_ordre_de_creation(self):
        evenement, premier = creer_evenement(nom_place='Zébulon')
        TypePlace.objects.create(evenement=evenement, nom='Alpha', capacite=5, prix_base_centimes=1000)
        TypePlace.objects.create(evenement=evenement, nom='Milieu', capacite=5, prix_base_centimes=1000)
        self.assertEqual([t['name'] for t in self.types(evenement)], ['Zébulon', 'Alpha', 'Milieu'])   # pas l'ordre alphabétique

    def test_les_types_d_un_autre_evenement_ne_se_melangent_pas(self):
        orga = creer_organisation()
        un, _type = creer_evenement(orga, titre='Un', nom_place='Place de Un')
        deux, _type = creer_evenement(orga, titre='Deux', nom_place='Place de Deux')
        self.assertEqual([t['name'] for t in self.types(un)], ['Place de Un'])
        self.assertEqual([t['name'] for t in self.types(deux)], ['Place de Deux'])


# ======================================================================================
# Modèle : monnaie, tarif en vigueur
# ======================================================================================
class ModeleEvenementTests(TestCase):
    def test_la_monnaie_est_toujours_enregistree_en_majuscules(self):
        evenement, _type = creer_evenement(devise=' xof ')
        evenement.refresh_from_db()
        self.assertEqual(evenement.devise, 'XOF')

    def test_la_monnaie_par_defaut_vient_des_reglages(self):
        with override_settings(DEVISE_PAR_DEFAUT='XOF'):
            evenement, _type = creer_evenement(titre='Réglage')
        self.assertEqual(evenement.devise, 'XOF')

    def test_une_monnaie_invalide_est_refusee_a_la_saisie(self):
        organisation = creer_organisation()
        for mauvaise in ['EURO', 'E1R', 'EU', '€']:
            with self.subTest(mauvaise):
                evenement = Evenement(organisation=organisation, titre='X', debut=ETE, devise=mauvaise)
                with self.assertRaises(ValidationError) as erreur:
                    evenement.full_clean()
                self.assertIn('devise', erreur.exception.message_dict)

    def test_tarif_en_vigueur_et_prix_a_sont_coherents(self):
        _evenement, type_place = creer_evenement(prix=2000)
        maintenant = timezone.now()
        self.assertIsNone(type_place.tarif_en_vigueur(maintenant))
        self.assertEqual(type_place.prix_a(maintenant), 2000)
        expire = Tarif.objects.create(type_place=type_place, prix_centimes=100, valide_jusqua=maintenant - timedelta(minutes=1))
        proche = Tarif.objects.create(type_place=type_place, prix_centimes=1200, valide_jusqua=maintenant + timedelta(days=2))
        Tarif.objects.create(type_place=type_place, prix_centimes=1500, valide_jusqua=maintenant + timedelta(days=9))
        self.assertEqual(type_place.tarif_en_vigueur(maintenant), proche)
        self.assertNotEqual(type_place.tarif_en_vigueur(maintenant), expire)
        self.assertEqual(type_place.prix_a(maintenant), 1200)

    def test_limite_d_annulation_avec_et_sans_date_propre(self):
        evenement, _type = creer_evenement(debut=ETE)
        parametres(delai_annulation_defaut_heures=36)
        self.assertEqual(evenement.limite_annulation, ETE - timedelta(hours=36))   # la propriété garde son comportement
        propre = instant(2099, 7, 1)
        evenement.date_limite_annulation = propre
        self.assertEqual(evenement.limite_annulation, propre)


class FormatTests(SimpleTestCase):
    def test_montant(self):
        self.assertEqual(serialisation.montant(2000), 20)
        self.assertIsInstance(serialisation.montant(2000), int)
        self.assertEqual(serialisation.montant(1550), 15.5)
        self.assertEqual(serialisation.montant(1999), 19.99)
        self.assertEqual(serialisation.montant(0), 0)


# ======================================================================================
# Réglages du site et pages légales
# ======================================================================================
class SiteEtPagesApiTests(ApiTestCase):
    def site(self):
        reponse = self.client.get(reverse('api_v1_site'))
        self.assertEqual(reponse.status_code, 200)
        return reponse.json()

    @override_settings(MAX_PLACES_PAR_COMMANDE=10, DEVISE_PAR_DEFAUT='EUR', TIME_ZONE='Europe/Paris')
    def test_site_non_configure_ne_renvoie_que_des_null_pour_les_textes(self):
        """Rien n'est inventé : tant que l'administrateur n'a rien saisi, l'application n'affiche rien."""
        self.assertEqual(self.site(), {
            'name': None, 'contactEmail': None, 'contactPhone': None, 'termsPage': None, 'privacyPage': None,
            'maxTicketsPerOrder': 10, 'defaultCurrency': 'EUR', 'defaultTimezone': 'Europe/Paris',
        })

    def test_les_regles_de_reservation_viennent_de_la_configuration_du_serveur(self):
        """L'application ne recopie pas ces règles : si le serveur change, elle suit."""
        with override_settings(MAX_PLACES_PAR_COMMANDE=4, DEVISE_PAR_DEFAUT='XOF', TIME_ZONE='Africa/Abidjan'):
            corps = self.site()
        self.assertEqual((corps['maxTicketsPerOrder'], corps['defaultCurrency'], corps['defaultTimezone']), (4, 'XOF', 'Africa/Abidjan'))

    def test_site_configure(self):
        cgv = PageLegale.objects.create(titre='Conditions générales de vente', contenu='Texte des CGV')
        confidentialite = PageLegale.objects.create(titre='Politique de confidentialité', contenu='Texte')
        parametres(nom_site='Mon site', email_contact='contact@exemple.test', telephone_contact='05 00 00 00 00',
                   page_cgv=cgv, page_confidentialite=confidentialite)
        corps = self.site()
        self.assertEqual({cle: corps[cle] for cle in ('name', 'contactEmail', 'contactPhone', 'termsPage', 'privacyPage')}, {
            'name': 'Mon site', 'contactEmail': 'contact@exemple.test', 'contactPhone': '05 00 00 00 00',
            'termsPage': {'slug': cgv.slug, 'title': 'Conditions générales de vente'},
            'privacyPage': {'slug': confidentialite.slug, 'title': 'Politique de confidentialité'},
        })

    def test_une_page_non_publiee_n_est_pas_proposee(self):
        brouillon = PageLegale.objects.create(titre='CGV en cours de rédaction', publiee=False)
        parametres(page_cgv=brouillon)
        self.assertIsNone(self.site()['termsPage'])

    def test_une_page_publiee(self):
        page = PageLegale.objects.create(titre='Mentions légales', contenu='Première ligne\nSeconde ligne')
        reponse = self.client.get(reverse('api_v1_page', args=[page.slug]))
        self.assertEqual(reponse.status_code, 200)
        corps = reponse.json()
        self.assertEqual({cle: corps[cle] for cle in ('slug', 'title', 'content')},
                         {'slug': 'mentions-legales', 'title': 'Mentions légales', 'content': 'Première ligne\nSeconde ligne'})
        self.assertEqual(set(corps), {'slug', 'title', 'content', 'updatedAt'})
        self.assertTrue(corps['updatedAt'].endswith('Z'))

    def test_page_non_publiee_ou_inconnue_donnent_la_meme_reponse(self):
        brouillon = PageLegale.objects.create(titre='Brouillon', publiee=False)
        reponses = {self.client.get(reverse('api_v1_page', args=[slug])) for slug in (brouillon.slug, 'inconnue')}
        self.assertEqual({r.status_code for r in reponses}, {404})
        self.assertEqual(len({r.content for r in reponses}), 1)

    def test_seule_la_lecture_est_acceptee(self):
        page = PageLegale.objects.create(titre='Mentions')
        for url in (reverse('api_v1_site'), reverse('api_v1_page', args=[page.slug])):
            for methode in ('post', 'put', 'delete'):
                with self.subTest(url=url, methode=methode):
                    self.assertEqual(getattr(self.client, methode)(url).status_code, 405)


# ======================================================================================
# CORS
# ======================================================================================
ORIGINE = 'http://localhost:8081'


@override_settings(CORS_ORIGINES_AUTORISEES=[ORIGINE])
class CorsTests(ApiTestCase):
    def test_origine_autorisee(self):
        reponse = self.client.get(self.url_liste, headers={'Origin': ORIGINE})
        self.assertEqual(reponse['Access-Control-Allow-Origin'], ORIGINE)
        self.assertIn('Origin', reponse['Vary'])
        self.assertNotIn('Access-Control-Allow-Credentials', reponse)   # jeton dans un en-tête, jamais de cookie

    def test_les_erreurs_portent_aussi_les_en_tetes(self):
        """Sans eux, le navigateur cacherait à l'application le corps d'un 404."""
        reponse = self.client.get(reverse('api_v1_evenement', args=['999999']), headers={'Origin': ORIGINE})
        self.assertEqual(reponse.status_code, 404)
        self.assertEqual(reponse['Access-Control-Allow-Origin'], ORIGINE)

    def test_autre_origine_refusee(self):
        reponse = self.client.get(self.url_liste, headers={'Origin': 'https://autre.example'})
        self.assertNotIn('Access-Control-Allow-Origin', reponse)
        self.assertIn('Origin', reponse['Vary'])   # un cache ne doit pas confondre les deux cas

    def test_sans_en_tete_origin(self):
        self.assertNotIn('Access-Control-Allow-Origin', self.client.get(self.url_liste))

    def test_pre_verification_du_navigateur(self):
        reponse = self.client.options(self.url_liste, headers={'Origin': ORIGINE, 'Access-Control-Request-Method': 'GET'})
        self.assertEqual(reponse.status_code, 204)
        self.assertEqual(reponse['Access-Control-Allow-Origin'], ORIGINE)
        for methode in ('GET', 'POST', 'PUT', 'DELETE'):   # l'application écrit aussi (réserver, créer et modifier un événement…)
            self.assertIn(methode, reponse['Access-Control-Allow-Methods'])
        self.assertIn('Authorization', reponse['Access-Control-Allow-Headers'])
        self.assertTrue(reponse['Access-Control-Max-Age'])

    def test_pre_verification_des_routes_protegees_sans_jeton(self):
        """Le navigateur envoie la pré-vérification SANS le jeton : elle ne doit donc pas exiger de connexion."""
        for chemin in ('/api/v1/auth/login/', '/api/v1/organizer/events/', '/api/v1/me/tickets/'):
            with self.subTest(chemin=chemin):
                reponse = self.client.options(chemin, headers={'Origin': ORIGINE, 'Access-Control-Request-Method': 'POST'})
                self.assertEqual(reponse.status_code, 204)
                self.assertEqual(reponse['Access-Control-Allow-Origin'], ORIGINE)

    def test_une_reponse_d_erreur_d_authentification_porte_les_en_tetes(self):
        reponse = self.client.get('/api/v1/me/', headers={'Origin': ORIGINE})
        self.assertEqual(reponse.status_code, 401)
        self.assertEqual(reponse['Access-Control-Allow-Origin'], ORIGINE)

    def test_pre_verification_d_une_origine_non_autorisee(self):
        reponse = self.client.options(self.url_liste, headers={'Origin': 'https://autre.example', 'Access-Control-Request-Method': 'GET'})
        self.assertNotEqual(reponse.status_code, 204)
        self.assertNotIn('Access-Control-Allow-Origin', reponse)

    def test_l_administration_n_est_pas_concernee(self):
        """CORS ne touche que /api/v1/ : l'administration Django ne doit jamais être lisible depuis un autre site."""
        reponse = self.client.get(reverse('admin:login'), headers={'Origin': ORIGINE})
        self.assertEqual(reponse.status_code, 200)
        self.assertNotIn('Access-Control-Allow-Origin', reponse)

    def test_par_defaut_aucun_site_tiers_n_est_autorise(self):
        with self.settings(CORS_ORIGINES_AUTORISEES=[]):
            reponse = self.client.get(self.url_liste, headers={'Origin': ORIGINE})
        self.assertNotIn('Access-Control-Allow-Origin', reponse)


class ReglageCorsTests(SimpleTestCase):
    def origines(self, valeur):
        with mock.patch.dict(os.environ, {'CORS_ORIGINES_AUTORISEES': valeur}):
            return reglages._origines_cors()

    def test_liste_nettoyee(self):
        self.assertEqual(self.origines(' http://localhost:8081/ , https://site.fr,, '), ['http://localhost:8081', 'https://site.fr'])

    def test_vide_par_defaut(self):
        self.assertEqual(self.origines(''), [])

    def test_valeurs_refusees(self):
        for mauvaise in ['*', 'localhost:8081', 'http://a.fr/chemin', 'ftp://a.fr', 'http://*.fr', 'http://a b.fr']:
            with self.subTest(mauvaise):
                with self.assertRaises(ImproperlyConfigured):
                    self.origines(mauvaise)


# ======================================================================================
# Contrat avec l'application : les types TypeScript (src/types/) font foi
# ======================================================================================
RACINE_DEPOT = Path(__file__).resolve().parents[2]   # backend/ticketing/tests_api_v1.py → racine du dépôt
TYPES_TS = RACINE_DEPOT / 'src' / 'types'


def textes_ts():
    return {fichier.name: fichier.read_text(encoding='utf8') for fichier in sorted(TYPES_TS.glob('*.ts'))}


def interfaces_ts():
    """Les noms des interfaces TypeScript de l'application (EventImage, Collective…)."""
    return {nom for texte in textes_ts().values() for nom in re.findall(r'export\s+interface\s+(\w+)', texte)}


def analyser_type(type_ts, interfaces):
    """`EventImage | null` → ({'objet', 'null'}, {'EventImage'}). Un littéral ("draft") ou un alias (EvenStatus) est du texte ;
    un tableau (`Collective[]`, `{ ... }[]`) est une liste ; une interface de l'application est un objet.
    Renvoie les genres JSON acceptés et les interfaces citées (pour vérifier aussi leur contenu)."""
    genres, references = set(), set()
    for morceau in (p.strip() for p in type_ts.split('|')):
        liste = morceau.endswith('[]')
        nom = morceau[:-2] if liste else morceau
        if nom in interfaces:
            references.add(nom)
        if liste:
            genres.add('liste')
        elif nom in interfaces:
            genres.add('objet')
        else:
            genres.add(nom if nom in ('number', 'boolean', 'null') else 'string')
    return genres, references


def genre_json(valeur):
    if valeur is None:
        return 'null'
    if isinstance(valeur, bool):
        return 'boolean'
    if isinstance(valeur, (int, float)):
        return 'number'
    if isinstance(valeur, list):
        return 'liste'
    if isinstance(valeur, dict):
        return 'objet'
    return 'string' if isinstance(valeur, str) else 'autre'


def lire_interface(nom):
    """Les propriétés d'une interface TypeScript de src/types : {nom: (facultative, genres, interfaces citées)}.
    Les propriétés héritées (`interface B extends A`) comptent."""
    interfaces = interfaces_ts()
    for texte in textes_ts().values():
        trouve = re.search(rf'export\s+interface\s+{nom}(?:\s+extends\s+(\w+))?\s*\{{(.*?)^\}}', texte, re.S | re.M)
        if trouve:
            break
    else:
        raise AssertionError(f'interface {nom} introuvable dans src/types')
    proprietes = lire_interface(trouve.group(1)) if trouve.group(1) else {}
    for ligne in trouve.group(2).splitlines():
        # le type va jusqu'au dernier « ; » de la ligne (il peut en contenir : `{ a: string; b: number }[]`), avant un éventuel commentaire
        propriete = re.match(r'\s*(\w+)(\?)?\s*:\s*(.+?);\s*(?://.*)?$', ligne)
        if propriete:
            genres, references = analyser_type(propriete.group(3), interfaces)
            proprietes[propriete.group(1)] = (bool(propriete.group(2)), genres, references)
    return proprietes


def valeurs_ts(fichier, motif):
    """Les valeurs entre guillemets d'une liste de valeurs TypeScript (`"a" | "b"`) trouvée avec `motif` (un groupe : la liste)."""
    trouve = re.search(motif, (TYPES_TS / fichier).read_text(encoding='utf8'))
    assert trouve, f'{motif!r} introuvable dans {fichier}'
    return set(re.findall(r'"(\w+)"', trouve.group(1)))


class VerificationContrat:
    """Compare une réponse de l'API à l'interface TypeScript correspondante, champ par champ, objets imbriqués compris."""

    def verifier(self, interface, donnees, optionnels_presents=None):
        """Les champs obligatoires du TypeScript sont tous là, aucun champ inconnu, et chaque valeur a le bon genre (texte, nombre,
        null…). `optionnels_presents` : None = on ne regarde pas les champs facultatifs (`earlyPrice?`) ; True / False = ils sont
        tous présents / tous absents (un champ facultatif est ABSENT quand il n'a pas de valeur, jamais null)."""
        proprietes = lire_interface(interface)
        obligatoires = {nom for nom, (facultative, _g, _r) in proprietes.items() if not facultative}
        facultatifs = set(proprietes) - obligatoires
        presents = set(donnees)
        self.assertLessEqual(obligatoires, presents, f'{interface} : champs manquants dans la réponse')
        self.assertLessEqual(presents, set(proprietes), f'{interface} : champs de la réponse inconnus du type TypeScript')
        if optionnels_presents is True:
            self.assertEqual(facultatifs, presents & facultatifs, f'{interface} : champs facultatifs attendus')
        if optionnels_presents is False:
            self.assertEqual(set(), presents & facultatifs, f'{interface} : champs facultatifs non attendus')
        for nom, (_facultative, genres, references) in proprietes.items():
            if nom not in donnees:
                continue
            valeur = donnees[nom]
            self.assertIn(genre_json(valeur), genres, f'{interface}.{nom} = {valeur!r} (attendu : {sorted(genres)})')
            elements = valeur if isinstance(valeur, list) else [valeur]
            for element in elements:
                if isinstance(element, dict) and len(references) == 1:
                    self.verifier(next(iter(references)), element)


@skipUnless(TYPES_TS.is_dir(), "types TypeScript de l'application absents (backend déployé seul)")
class ContratReactTests(VerificationContrat, ApiTestCase):
    """Si un fichier de src/types/ change sans l'API (ou l'inverse), un de ces tests échoue."""

    def appel(self, methode, nom_url, args=(), utilisateur=None, corps=None):
        en_tete = en_tete_auth(utilisateur) if utilisateur else {}
        url = reverse(nom_url, args=args)
        if corps is None:
            return getattr(self.client, methode)(url, headers=en_tete)
        return getattr(self.client, methode)(url, json.dumps(corps), content_type='application/json', headers=en_tete)

    # ---------------------------------------------------------------- public
    def test_evenement(self):
        lieu = Lieu.objects.create(nom='Salle', ville='Bordeaux')
        avec_portes, _type = creer_evenement(titre='Avec portes', lieu=lieu, ouverture_portes=time(19, 0))
        sans_portes, _type = creer_evenement(titre='Sans portes')
        for evenement in (avec_portes, sans_portes):
            with self.subTest(evenement.titre):
                self.verifier('Event', self.fiche(evenement))
        for element in self.liste():
            self.verifier('Event', element)

    def test_type_de_place_sans_puis_avec_tarif_early(self):
        evenement, type_place = creer_evenement()
        self.verifier('TicketType', self.types(evenement)[0], optionnels_presents=False)
        Tarif.objects.create(type_place=type_place, prix_centimes=1500, valide_jusqua=timezone.now() + timedelta(days=3))
        self.verifier('TicketType', self.types(evenement)[0], optionnels_presents=True)

    def test_reglages_du_site_et_pages_legales(self):
        cgv = PageLegale.objects.create(titre='Conditions générales de vente', contenu='Texte')
        self.verifier('SiteInfo', self.client.get(reverse('api_v1_site')).json())   # rien de saisi : des null
        parametres(nom_site='Mon site', email_contact='contact@exemple.test', telephone_contact='05 00 00 00 00', page_cgv=cgv)
        site = self.client.get(reverse('api_v1_site')).json()
        self.assertEqual(site['termsPage']['slug'], cgv.slug)   # la page liée est un objet : sa forme est vérifiée aussi
        self.verifier('SiteInfo', site)
        self.verifier('LegalPage', self.client.get(reverse('api_v1_page', args=[cgv.slug])).json())

    # ---------------------------------------------------------------- acheteur
    def acheteur_avec_billets(self):
        """Un acheteur vérifié avec 2 billets payés, dont le premier est déjà scanné."""
        evenement, type_place = creer_evenement()
        acheteur = creer_utilisateur('acheteur@test.fr', email_verifie=True)
        commande = services.reserver(evenement, acheteur.email, [(type_place.id, 2)], utilisateur=acheteur)
        services.confirmer_paiement('evt-contrat', commande.pk, commande.total_centimes)
        services.valider_entree(Billet.objects.order_by('pk').first().code)
        return acheteur

    def test_billet(self):
        acheteur = self.acheteur_avec_billets()
        billets = self.appel('get', 'api_mes_billets', utilisateur=acheteur).json()['results']
        self.assertEqual({b['ticket']['status'] for b in billets}, {'valid', 'used'})   # les deux formes du billet
        for element in billets:
            with self.subTest(statut=element['ticket']['status']):
                self.verifier('TicketDetails', element)
                # `usedAt` est facultatif côté application : présent seulement pour un billet scanné
                self.verifier('Ticket', element['ticket'], optionnels_presents=element['ticket']['status'] == 'used')
        un_seul = self.appel('get', 'api_mon_billet', (billets[0]['ticket']['id'],), utilisateur=acheteur).json()
        self.verifier('TicketDetails', un_seul)

    def test_reservation_en_attente(self):
        acheteur = creer_utilisateur('acheteur@test.fr', email_verifie=True)
        evenement, type_place = creer_evenement()
        corps = {'items': [{'ticketTypeId': str(type_place.pk), 'quantity': 2}], 'paymentMethod': 'card'}
        creee = self.appel('post', 'api_reserver', (evenement.pk,), acheteur, corps)
        self.assertEqual(creee.status_code, 201)
        en_cours = self.appel('get', 'api_mes_reservations', utilisateur=acheteur).json()['results']
        self.assertEqual(len(en_cours), 1)
        for commande in (creee.json(), en_cours[0]):   # même forme à la création et dans la liste
            self.verifier('PendingOrderDetails', commande)
            self.verifier('PendingOrder', commande['order'], optionnels_presents=True)

    # ---------------------------------------------------------------- compte
    def test_utilisateur_acheteur_puis_organisateur(self):
        acheteur = creer_utilisateur('acheteur@test.fr')
        organisateur = creer_utilisateur('organisateur@test.fr')
        Membre.objects.create(utilisateur=organisateur, organisation=creer_organisation(), role=Membre.GESTIONNAIRE)
        # `collectiveId` est facultatif côté application : absent pour un acheteur, présent pour un organisateur
        for utilisateur, avec_collectif in ((acheteur, False), (organisateur, True)):
            with self.subTest(utilisateur.username):
                reponse = self.appel('get', 'api_moi', utilisateur=utilisateur)
                self.assertEqual(reponse.status_code, 200)
                self.verifier('User', reponse.json(), optionnels_presents=avec_collectif)

    def test_la_session_de_la_connexion_et_de_l_inscription(self):
        creer_utilisateur('acheteur@test.fr', mot_de_passe='motdepasse-test-123')
        connexion = self.appel('post', 'api_connexion', corps={'username': 'acheteur', 'password': 'motdepasse-test-123'})
        self.assertEqual(connexion.status_code, 200)
        self.verifier('AuthSession', connexion.json())
        inscription = self.appel('post', 'api_inscription', corps={
            'username': 'nouveau_membre', 'email': 'nouveau@test.fr', 'password': 'un-mot-de-passe-solide-42', 'acceptTerms': True})
        self.assertEqual(inscription.status_code, 201)
        self.verifier('AuthSession', inscription.json())

    # ---------------------------------------------------------------- organisateur
    def organisateur_avec_ventes(self):
        organisation = creer_organisation('Collectif A')
        organisateur = creer_utilisateur('organisateur@test.fr')
        Membre.objects.create(utilisateur=organisateur, organisation=organisation, role=Membre.GESTIONNAIRE)
        evenement, type_place = creer_evenement(organisation, devise='EUR')
        commande = services.reserver(evenement, 'a@test.fr', [(type_place.id, 2)])
        services.confirmer_paiement('evt-orga', commande.pk, commande.total_centimes)
        Commande.objects.create(evenement=evenement, email='b@test.fr', statut=Commande.EXPIREE, total_centimes=2000,
                                expire_le=timezone.now(), a_rembourser=True)
        return organisateur, evenement

    def test_types_de_place_de_l_organisateur(self):
        organisateur, evenement = self.organisateur_avec_ventes()
        for type_place in self.appel('get', 'api_orga_types_place', (evenement.pk,), organisateur).json()['results']:
            self.verifier('OrganizerTicketType', type_place, optionnels_presents=False)
            self.assertEqual({'sold', 'held'}, serialisation.CHAMPS_ORGANISATEUR_TYPE_PLACE)

    def test_chiffres_de_vente(self):
        organisateur, evenement = self.organisateur_avec_ventes()
        self.verifier('EventStats', self.appel('get', 'api_orga_stats', (evenement.pk,), organisateur).json())
        resume = self.appel('get', 'api_orga_resume', utilisateur=organisateur).json()['results']
        self.assertTrue(resume)
        for monnaie in resume:
            self.verifier('CollectiveSummary', monnaie)

    def test_evenements_de_l_organisateur(self):
        organisateur, _evenement = self.organisateur_avec_ventes()
        liste = self.appel('get', 'api_orga_evenements', utilisateur=organisateur).json()['results']
        self.assertTrue(liste)
        for evenement in liste:
            self.verifier('Event', evenement)

    # ---------------------------------------------------------------- valeurs
    def test_les_valeurs_de_l_api_existent_dans_les_types_typescript(self):
        """Si l'API émet une valeur que le type TypeScript ne connaît pas, l'application la traiterait comme impossible."""
        statuts_evenement = valeurs_ts('even.ts', r'export\s+type\s+EvenStatus\s*=\s*([^;]+);')
        self.assertEqual({serialisation.BROUILLON, serialisation.EN_VENTE, serialisation.COMPLET, serialisation.TERMINE, serialisation.ANNULE},
                         statuts_evenement)
        self.assertEqual(set(serialisation.STATUTS_BILLET.values()), valeurs_ts('order.ts', r'export\s+type\s+TicketStatus\s*=\s*([^;]+);'))
        self.assertEqual(set(serialisation.MOYENS_PAIEMENT.values()), valeurs_ts('order.ts', r'paymentMethod\s*:\s*([^;]+);'))
        self.assertEqual({'buyer', 'organizer'}, valeurs_ts('user.ts', r'export\s+type\s+Role\s*=\s*([^;]+);'))
        self.assertEqual(set(serialisation.ROLES_COLLECTIF.values()), valeurs_ts('user.ts', r'export\s+type\s+CollectiveRole\s*=\s*([^;]+);'))


@skipUnless(TYPES_TS.is_dir(), "types TypeScript de l'application absents (backend déployé seul)")
class ContratImageTests(VerificationContrat, StockageTemporaire, ApiTestCase):
    """L'affiche d'un événement : une image réelle, enregistrée dans un dossier jetable."""

    def test_evenement_avec_image(self):
        evenement, _type = creer_evenement(image_principale=creer_image(largeur=1200, hauteur=800), image_principale_alt='Affiche du concert')
        fiche = self.fiche(evenement)
        self.assertIsNotNone(fiche['image'])
        self.verifier('Event', fiche)   # l'objet `image` est vérifié contre l'interface EventImage
        self.assertEqual({cle for source in fiche['image']['sources'] for cle in source}, {'width', 'url'})   # les versions : { width; url }
