"""Adresses : l'administration Django (pour les équipes) et l'API JSON (pour l'application)."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('ticketing.urls')),
]
if settings.DEBUG:   # en développement, Django sert les images téléversées
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
