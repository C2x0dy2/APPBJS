from django.urls import path

from . import api

urlpatterns = [
    path('events/', api.liste_evenements, name='api_evenements'),
    path('events/<int:evenement_id>/reserve/', api.reserver, name='api_reserver'),
    path('webhooks/payment/', api.webhook_paiement, name='api_webhook_paiement'),
]
