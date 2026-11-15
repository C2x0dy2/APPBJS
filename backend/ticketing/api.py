"""API JSON publique : liste des événements, réservation, notification de paiement."""
import hashlib
import hmac
import json

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import services
from .models import Commande, Evenement, TypePlace


def _json(request):
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _erreur(message, statut=400):
    return JsonResponse({'error': message}, status=statut)


@require_GET
def liste_evenements(request):
    maintenant = timezone.now()
    sortie = []
    for ev in Evenement.objects.publies_a_venir(maintenant).prefetch_related('types_place__tarifs'):
        sortie.append({
            'id': ev.id, 'title': ev.titre, 'is_online': ev.est_en_ligne,
            'venue': ev.lieu.nom if ev.lieu else '',
            'starts_at_utc': ev.debut.isoformat(),
            'starts_at_local': ev.debut_local.isoformat(), 'timezone': ev.fuseau_horaire,
            'ticket_types': [{
                'id': t.id, 'name': t.nom, 'price_cents': t.prix_a(maintenant, list(t.tarifs.all())),
                'available': t.disponibles, 'sold_out': t.disponibles <= 0,
            } for t in ev.types_place.all()],
        })
    return JsonResponse({'events': sortie})


@csrf_exempt
@require_POST
def reserver(request, evenement_id):
    data = _json(request)
    if data is None:
        return _erreur(_('JSON invalide'))
    try:
        evenement = Evenement.objects.get(pk=evenement_id, publie=True)
    except Evenement.DoesNotExist:
        return _erreur(_('Événement introuvable'), 404)
    if request.user.is_authenticated and not request.user.email_verifie:
        # Un compte non vérifié peut naviguer, mais doit vérifier son e-mail avant de payer.
        return _erreur(_('Vérifie ton adresse e-mail avant de payer.'), 403)
    moyen = data.get('payment_method', 'carte')
    email = data.get('email', '')
    if moyen not in settings.DUREES_RETENUE_MINUTES or '@' not in email:
        return _erreur(_('E-mail ou moyen de paiement invalide'))
    try:
        lignes = [(int(i['ticket_type']), int(i['quantity'])) for i in data['items']]
    except (KeyError, TypeError, ValueError):
        return _erreur(_('Articles invalides'))
    maximum = settings.MAX_PLACES_PAR_COMMANDE
    if not lignes or any(q < 1 for _t, q in lignes) or sum(q for _t, q in lignes) > maximum:
        return _erreur(_('Entre 1 et %(max)s places par commande') % {'max': maximum})
    ids = {t for t, _q in lignes}
    if TypePlace.objects.filter(evenement=evenement, pk__in=ids).count() != len(ids):
        return _erreur(_('Catégorie inconnue'))
    try:
        commande = services.reserver(evenement, email, lignes, moyen)
    except services.PlusDePlaces as e:
        return JsonResponse({'error': 'sold_out', 'ticket_type': e.type_place.nom}, status=409)
    return JsonResponse({
        'order_id': commande.id, 'total_cents': commande.total_centimes,
        'expires_at': commande.expire_le.isoformat(),
    }, status=201)


@csrf_exempt
@require_POST
def webhook_paiement(request):
    """Notification du prestataire. Signature HMAC-SHA256 du corps brut dans X-Signature."""
    secret = settings.PAYMENT_WEBHOOK_SECRET
    if not secret:
        return _erreur(_('Paiement non configuré'), 503)
    attendu = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(attendu, request.headers.get('X-Signature', '')):
        return _erreur(_('Signature invalide'), 401)
    data = _json(request)
    try:
        id_evt, commande_id, montant = str(data['event_id']), int(data['order_id']), int(data['amount_cents'])
    except (TypeError, KeyError, ValueError):
        return _erreur(_('Corps invalide'))
    try:
        commande = Commande.objects.get(pk=commande_id)
    except Commande.DoesNotExist:
        return _erreur(_('Commande inconnue'), 404)
    if montant != commande.total_centimes:
        return _erreur(_('Montant inattendu'))
    # Toujours 200 pour un rejeu : le prestataire ne doit pas réessayer indéfiniment.
    return JsonResponse({'result': services.confirmer_paiement(id_evt, commande_id, montant)})
