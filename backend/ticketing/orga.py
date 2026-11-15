"""
Espace organisateur (/orga/<slug>/…).

Versions minimales : elles servent surtout à poser le contrôle d'accès (acces.py) et à le tester.
Le tableau de bord complet et le scanner viendront aux étapes suivantes.
"""
import csv
import json

from django.conf import settings
from django.contrib import messages
from django.db.models import F, Sum
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.utils.translation import gettext as _
from django.views.decorators.http import require_GET, require_POST

from . import services
from .acces import ROLES_GESTION, TOUS_LES_ROLES, evenements_de, organisation_requise
from .forms_orga import FormSetGalerie, FormulaireAjoutGalerie, FormulaireImagePrincipale
from .models import Billet, Commande, ImageEvenement, LigneCommande


@require_GET
@organisation_requise(roles=ROLES_GESTION)
def tableau_de_bord(request):
    evenements = evenements_de(request).prefetch_related('types_place').order_by('debut')
    lignes = [{
        'evenement': e,
        'vendues': sum(t.vendues for t in e.types_place.all()),
        'capacite': sum(t.capacite for t in e.types_place.all()),
    } for e in evenements]
    return render(request, 'ticketing/orga/tableau_de_bord.html', {'organisation': request.organisation, 'lignes': lignes})


@require_GET
@organisation_requise(roles=ROLES_GESTION)
def evenement(request, evenement_id):
    evenement = get_object_or_404(evenements_de(request), pk=evenement_id)
    types = []
    for t in evenement.types_place.all():
        encaisse = LigneCommande.objects.filter(type_place=t, commande__statut=Commande.PAYEE).aggregate(
            s=Sum(F('quantite') * F('prix_unitaire_centimes')))['s'] or 0
        types.append({'type': t, 'encaisse': encaisse})
    return render(request, 'ticketing/orga/evenement.html', {
        'organisation': request.organisation, 'evenement': evenement, 'types': types,
        'total_encaisse': sum(l['encaisse'] for l in types)})


def _cellule_sure(valeur):
    """Évite l'injection de formule quand le fichier est ouvert dans un tableur."""
    texte = str(valeur)
    return "'" + texte if texte[:1] in ('=', '+', '-', '@') else texte


@require_GET
@organisation_requise(roles=ROLES_GESTION)
def export_participants(request, evenement_id):
    evenement = get_object_or_404(evenements_de(request), pk=evenement_id)
    reponse = HttpResponse(content_type='text/csv; charset=utf-8')
    reponse['Content-Disposition'] = f'attachment; filename="participants-{evenement.slug}.csv"'
    reponse.write('﻿')   # pour qu'Excel lise bien les accents
    ecrivain = csv.writer(reponse)
    ecrivain.writerow([_('E-mail'), _('Type de place'), _('N° de billet'), _('Statut'), _('Scanné')])
    billets = Billet.objects.filter(commande__evenement=evenement).select_related('commande', 'type_place').order_by('commande_id', 'numero')
    for b in billets:
        ecrivain.writerow([_cellule_sure(b.commande.email), _cellule_sure(b.type_place.nom), b.numero, b.statut,
                           _('oui') if b.statut == Billet.UTILISE else _('non')])
    return reponse


@require_POST
@organisation_requise(roles=TOUS_LES_ROLES)
def valider_entree(request, evenement_id):
    """Côté serveur du scanner : valide un billet de CET événement, de façon atomique."""
    evenement = get_object_or_404(evenements_de(request), pk=evenement_id)
    try:
        code = str(json.loads(request.body or b'{}').get('code', ''))
    except (ValueError, AttributeError):
        raise Http404
    billet = Billet.objects.filter(code=code, commande__evenement=evenement).select_related('type_place').first()
    if billet is None:
        # Même réponse pour un code inconnu, d'une autre organisation ou d'un autre événement : rien n'est révélé.
        return JsonResponse({'result': 'invalid'})
    resultat = services.valider_entree(code, timezone.now())
    return JsonResponse({'result': resultat, 'ticket_type': billet.type_place.nom})


@organisation_requise(roles=ROLES_GESTION)
def images_evenement(request, evenement_id):
    """Image principale et galerie d'un événement : ajout, description, suppression, ordre.

    Trois formulaires sur la même page, distingués par le champ caché « action ». Tout part de
    evenements_de(request) : on ne peut jamais toucher aux images d'un autre collectif.
    """
    evenement = get_object_or_404(evenements_de(request), pk=evenement_id)
    action = request.POST.get('action', '') if request.method == 'POST' else ''
    est = lambda nom: action == nom
    f_principale = FormulaireImagePrincipale(request.POST if est('principale') else None, request.FILES if est('principale') else None,
                                             instance=evenement, prefix='principale')
    f_ajout = FormulaireAjoutGalerie(request.POST if est('ajouter') else None, request.FILES if est('ajouter') else None, prefix='ajout')
    f_galerie = FormSetGalerie(request.POST if est('galerie') else None, queryset=evenement.galerie.all(), prefix='galerie')

    if request.method == 'POST':
        if est('principale') and f_principale.is_valid():
            f_principale.save()
            messages.success(request, _('Image principale enregistrée.'))
            return redirect('orga_images', slug=request.organisation.slug, evenement_id=evenement.pk)
        if est('ajouter') and f_ajout.is_valid():
            image = f_ajout.save(commit=False)
            image.evenement = evenement
            image.ordre = (evenement.galerie.order_by('-ordre').values_list('ordre', flat=True).first() or 0) + 1
            image.save()
            messages.success(request, _('Image ajoutée à la galerie.'))
            return redirect('orga_images', slug=request.organisation.slug, evenement_id=evenement.pk)
        if est('galerie') and f_galerie.is_valid():
            f_galerie.save()
            for position, image in enumerate(evenement.galerie.order_by('ordre', 'pk')):   # renumérote proprement 0, 1, 2…
                if image.ordre != position:
                    ImageEvenement.objects.filter(pk=image.pk).update(ordre=position)
            messages.success(request, _('Galerie enregistrée.'))
            return redirect('orga_images', slug=request.organisation.slug, evenement_id=evenement.pk)
        if action not in ('principale', 'ajouter', 'galerie'):
            raise Http404

    return render(request, 'ticketing/orga/images.html', {
        'organisation': request.organisation, 'evenement': evenement,
        'f_principale': f_principale, 'f_ajout': f_ajout, 'f_galerie': f_galerie,
        'max_mo': settings.IMAGE_TAILLE_MAX_MO, 'max_octets': settings.IMAGE_TAILLE_MAX_MO * 1024 * 1024,
        'largeur_min': settings.IMAGE_LARGEUR_MIN, 'hauteur_min': settings.IMAGE_HAUTEUR_MIN})
