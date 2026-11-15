from django.contrib.auth.views import LogoutView
from django.urls import path

from . import views

app_name = 'compte'

urlpatterns = [
    path('connexion/', views.VueConnexion.as_view(), name='connexion'),
    path('inscription/', views.VueInscription.as_view(), name='inscription'),
    path('deconnexion/', LogoutView.as_view(), name='deconnexion'),   # POST uniquement (Django refuse GET)
    path('billets/', views.mes_billets, name='mes_billets'),

    path('verification/renvoyer/', views.renvoyer_verification, name='renvoyer_verification'),
    path('verification/<str:jeton>/', views.verifier_email, name='verifier_email'),

    path('mot-de-passe/oublie/', views.VueMdpOublie.as_view(), name='mdp_oublie'),
    path('mot-de-passe/envoye/', views.VueMdpEnvoye.as_view(), name='mdp_envoye'),
    path('mot-de-passe/nouveau/<uidb64>/<token>/', views.VueMdpNouveau.as_view(), name='mdp_nouveau'),
    path('mot-de-passe/termine/', views.VueMdpTermine.as_view(), name='mdp_termine'),
]
