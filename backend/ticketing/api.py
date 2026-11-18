"""Notification de paiement du prestataire (webhook). Le reste de l'API est dans api_v1.py, api_acheteur.py et api_organisateur.py."""
import hashlib
import hmac
import json

from django.conf import settings
from django.http import JsonResponse
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import services
from .models import Commande


def _json(request):
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _erreur(message, statut=400):
    return JsonResponse({'error': message}, status=statut)


@csrf_exempt
@require_POST
def webhook_paiement(request):
    """Notification du prestataire. Signature HMAC-SHA256 du corps brut dans X-Signature."""
    secret = settings.PAYMENT_WEBHOOK_SECRET
    if not secret:
        return _erreur(_('Paiement non configuré'), 503)
    attendu = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    recue = request.headers.get('X-Signature', '')
    # On compare des OCTETS : compare_digest refuse le texte non ASCII, et un en-tête hostile ferait planter la vue (500) au lieu de répondre 401.
    if not hmac.compare_digest(attendu.encode(), recue.encode()):
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
