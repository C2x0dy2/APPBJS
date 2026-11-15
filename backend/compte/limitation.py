"""
Limitation des tentatives de connexion (protection contre la force brute).

On compte les ÉCHECS par couple (adresse IP, e-mail) dans le cache Django. Une fois le maximum
atteint, les tentatives suivantes sont refusées jusqu'à la fin de la fenêtre, même avec le bon mot
de passe : c'est le principe d'un blocage. Une connexion réussie remet le compteur à zéro.

Réglages : CONNEXION_TENTATIVES_MAX et CONNEXION_FENETRE_MINUTES (settings.py / .env).

Limites connues : le cache par défaut (mémoire locale) est propre à chaque processus ; en production
avec plusieurs processus, configurer un cache partagé. L'adresse IP est REMOTE_ADDR : derrière un
proxy, il faut que celui-ci la transmette correctement (sinon tous les visiteurs partagent la même).
"""
import hashlib
import math
import time

from django.conf import settings
from django.core.cache import cache


def normaliser_email(email):
    return (email or '').strip().lower()


def _cles(request, email):
    empreinte = hashlib.sha256(f"{request.META.get('REMOTE_ADDR', '')}|{normaliser_email(email)}".encode()).hexdigest()
    return f'connexion-echecs:{empreinte}', f'connexion-fin:{empreinte}'


def _fenetre_secondes():
    return settings.CONNEXION_FENETRE_MINUTES * 60


def minutes_restantes(request, email):
    """0 si la connexion est autorisée, sinon le nombre de minutes (arrondi au-dessus) avant de pouvoir réessayer."""
    cle_n, cle_fin = _cles(request, email)
    if (cache.get(cle_n) or 0) < settings.CONNEXION_TENTATIVES_MAX:
        return 0
    reste = (cache.get(cle_fin) or 0) - time.time()
    return max(1, math.ceil(reste / 60)) if reste > 0 else 0


def enregistrer_echec(request, email):
    cle_n, cle_fin = _cles(request, email)
    fenetre = _fenetre_secondes()
    if cache.add(cle_n, 1, timeout=fenetre):       # premier échec : la fenêtre démarre
        cache.add(cle_fin, time.time() + fenetre, timeout=fenetre)
        return
    try:
        cache.incr(cle_n)
    except ValueError:                              # expiré entre-temps : on repart d'un échec
        cache.add(cle_n, 1, timeout=fenetre)
        cache.set(cle_fin, time.time() + fenetre, timeout=fenetre)


def reinitialiser(request, email):
    cache.delete_many(list(_cles(request, email)))
