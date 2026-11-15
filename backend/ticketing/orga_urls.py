"""Adresses de l'espace organisateur : /orga/<slug>/…  Le slug est lu par le contrôle d'accès (acces.py)."""
from django.urls import path

from . import orga

urlpatterns = [
    path('', orga.tableau_de_bord, name='orga_tableau_de_bord'),
    path('evenements/<int:evenement_id>/', orga.evenement, name='orga_evenement'),
    path('evenements/<int:evenement_id>/images/', orga.images_evenement, name='orga_images'),
    path('evenements/<int:evenement_id>/export.csv', orga.export_participants, name='orga_export'),
    path('scan/<int:evenement_id>/valider/', orga.valider_entree, name='orga_valider_entree'),
]
