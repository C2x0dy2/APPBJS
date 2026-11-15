"""Calculs d'affichage des événements : tout vient de la base, rien n'est écrit en dur."""

STATUT_DISPONIBLE, STATUT_PRESQUE_COMPLET, STATUT_COMPLET = 'disponible', 'presque_complet', 'complet'


def preparer_evenements(evenements, maintenant, parametres):
    """Évalue la requête et ajoute à chaque événement les valeurs calculées en base :
    places_restantes, prix_min (centimes), gratuit et statut (None si aucun type de place)."""
    liste = list(evenements.select_related('categorie', 'lieu').prefetch_related('types_place__tarifs'))
    seuil = parametres.seuil_dernieres_places_pct
    for ev in liste:
        types = list(ev.types_place.all())
        capacite = sum(t.capacite for t in types)
        ev.places_restantes = sum(t.disponibles for t in types)
        prix = [t.prix_a(maintenant, list(t.tarifs.all())) for t in types]
        ev.prix_min = min(prix) if prix else None
        ev.gratuit = ev.prix_min == 0
        if not types:
            ev.statut = None
        elif ev.places_restantes <= 0:
            ev.statut = STATUT_COMPLET
        elif ev.places_restantes * 100 < seuil * capacite:   # moins de « seuil % » de places restantes
            ev.statut = STATUT_PRESQUE_COMPLET
        else:
            ev.statut = STATUT_DISPONIBLE
    return liste
