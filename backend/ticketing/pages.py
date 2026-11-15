"""Pages publiques : accueil, liste/recherche d'événements, fiche d'un événement."""
from django.db.models import Q
from django.shortcuts import get_object_or_404, render
from django.utils import timezone

from .models import Categorie, Evenement, PageLegale, ParametresSite
from .presenters import preparer_evenements


def accueil(request):
    maintenant = timezone.now()
    parametres = ParametresSite.charger()
    a_la_une = Evenement.objects.publies_a_venir(maintenant).filter(a_la_une=True)[:parametres.nombre_evenements_a_la_une]
    return render(request, 'ticketing/accueil.html', {'a_la_une': preparer_evenements(a_la_une, maintenant, parametres)})


def evenements(request):
    """Programmation, résultats de recherche et pages de catégorie (?q=… et/ou ?categorie=slug)."""
    maintenant = timezone.now()
    parametres = ParametresSite.charger()
    q = request.GET.get('q', '').strip()[:80]
    slug = request.GET.get('categorie', '').strip()
    categorie = get_object_or_404(Categorie, slug=slug, actif=True) if slug else None

    a_venir = Evenement.objects.publies_a_venir(maintenant)
    resultats = a_venir
    if categorie:
        resultats = resultats.filter(categorie=categorie)
    for mot in q.split()[:6]:   # chaque mot doit se trouver quelque part
        resultats = resultats.filter(
            Q(titre__icontains=mot) | Q(artiste__icontains=mot) | Q(description__icontains=mot)
            | Q(categorie__nom__icontains=mot) | Q(lieu__nom__icontains=mot) | Q(lieu__ville__icontains=mot))
    cartes = preparer_evenements(resultats.distinct().order_by('debut'), maintenant, parametres)
    return render(request, 'ticketing/evenements.html', {
        'q': q, 'categorie_active': categorie, 'cartes': cartes, 'aucun_evenement': not a_venir.exists()})


def evenement_detail(request, slug):
    maintenant = timezone.now()
    parametres = ParametresSite.charger()
    evenement = get_object_or_404(Evenement.objects.filter(publie=True), slug=slug)
    fiche = preparer_evenements(Evenement.objects.filter(pk=evenement.pk).prefetch_related('galerie'), maintenant, parametres)[0]
    types = [{'type': t, 'prix': t.prix_a(maintenant, list(t.tarifs.all()))} for t in fiche.types_place.all()]
    return render(request, 'ticketing/evenement_detail.html', {'evenement': fiche, 'types': types})


def page_legale(request, slug):
    """CGV, confidentialité… : texte saisi dans l'admin, visible seulement si la page est publiée."""
    page = get_object_or_404(PageLegale, slug=slug, publiee=True)
    return render(request, 'ticketing/page_legale.html', {'page': page})
