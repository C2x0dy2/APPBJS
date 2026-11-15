"""Adresses du site."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from ticketing import pages

urlpatterns = [
    path('', pages.accueil, name='accueil'),
    path('evenements/', pages.evenements, name='evenements'),
    path('evenement/<slug:slug>/', pages.evenement_detail, name='evenement_detail'),
    path('page/<slug:slug>/', pages.page_legale, name='page_legale'),
    path('compte/', include('compte.urls')),
    path('admin/', admin.site.urls),
    path('api/', include('ticketing.urls')),
    path('orga/<slug:slug>/', include('ticketing.orga_urls')),
]
if settings.DEBUG:   # en développement, Django sert les images téléversées
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
