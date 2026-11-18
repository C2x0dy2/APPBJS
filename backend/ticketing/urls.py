"""Adresses de l'API (toutes sous /api/). Le format des réponses est décrit dans serialisation.py."""
from django.urls import path, re_path

from compte import api as compte_api

from . import api, api_acheteur, api_organisateur, api_v1

urlpatterns = [
    # --- notification de paiement du prestataire ---
    path('v1/webhooks/payment/', api.webhook_paiement, name='api_webhook_paiement'),

    # --- compte ---
    path('v1/auth/register/', compte_api.inscription, name='api_inscription'),
    path('v1/auth/login/', compte_api.connexion, name='api_connexion'),
    path('v1/auth/logout/', compte_api.deconnexion, name='api_deconnexion'),
    path('v1/auth/verify-email/', compte_api.verifier_email, name='api_verifier_email'),
    path('v1/auth/resend-verification/', compte_api.renvoyer_verification, name='api_renvoyer_verification'),
    path('v1/auth/password-reset/', compte_api.mot_de_passe_oublie, name='api_mdp_oublie'),
    path('v1/auth/password-reset/confirm/', compte_api.nouveau_mot_de_passe, name='api_mdp_nouveau'),
    path('v1/me/', compte_api.moi, name='api_moi'),

    # --- public : événements, réglages du site, pages légales ---
    path('v1/events/', api_v1.liste_evenements, name='api_v1_evenements'),
    path('v1/events/<str:evenement_id>/', api_v1.detail_evenement, name='api_v1_evenement'),
    path('v1/events/<str:evenement_id>/ticket-types/', api_v1.types_place_evenement, name='api_v1_types_place'),
    path('v1/site/', api_v1.reglages_site, name='api_v1_site'),
    path('v1/pages/<slug:slug>/', api_v1.page_legale, name='api_v1_page'),

    # --- acheteur connecté ---
    path('v1/events/<str:evenement_id>/reservations/', api_acheteur.reserver, name='api_reserver'),
    path('v1/me/tickets/', api_acheteur.mes_billets, name='api_mes_billets'),
    path('v1/me/tickets/<str:billet_id>/', api_acheteur.mon_billet, name='api_mon_billet'),
    path('v1/me/reservations/', api_acheteur.mes_reservations, name='api_mes_reservations'),

    # --- organisateur (cloisonné par collectif) ---
    path('v1/organizer/events/', api_organisateur.evenements, name='api_orga_evenements'),
    path('v1/organizer/events/<str:evenement_id>/', api_organisateur.evenement, name='api_orga_evenement'),
    path('v1/organizer/events/<str:evenement_id>/ticket-types/', api_organisateur.types_place, name='api_orga_types_place'),
    path('v1/organizer/events/<str:evenement_id>/cancel/', api_organisateur.annuler, name='api_orga_annuler'),
    path('v1/organizer/events/<str:evenement_id>/stats/', api_organisateur.stats_evenement, name='api_orga_stats'),
    path('v1/organizer/events/<str:evenement_id>/scan/', api_organisateur.valider_entree, name='api_orga_scan'),
    path('v1/organizer/events/<str:evenement_id>/participants.csv', api_organisateur.export_participants, name='api_orga_participants'),
    path('v1/organizer/events/<str:evenement_id>/image/', api_organisateur.image_principale, name='api_orga_image'),
    path('v1/organizer/summary/', api_organisateur.resume, name='api_orga_resume'),

    re_path(r'^v1/(?P<chemin>.*)$', api_v1.route_inconnue, name='api_v1_inconnue'),   # toujours en dernier
]
