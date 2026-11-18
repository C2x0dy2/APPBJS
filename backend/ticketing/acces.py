"""
Contrôle d'accès de l'espace organisateur : UN seul endroit décide qui entre.

Un collectif (Organisation) ne voit que ses données. Un utilisateur appartient à un collectif par une fiche Membre,
avec un rôle (administrateur, gestionnaire, contrôleur). Dans TOUS les cas d'échec (collectif inconnu, inactif,
utilisateur non membre, mauvais rôle, événement d'un autre collectif) la réponse est la même 404 : on ne révèle pas
qu'un collectif ou un événement existe.

Règle pour les vues : ne jamais lire un événement par son identifiant seul. Toujours passer par `evenement_gere()`
ou par `evenements_de(organisation)`.
"""
from .api_commun import NonTrouve, identifiant_entier
from .models import Evenement, Membre, Organisation

TOUS_LES_ROLES = tuple(role for role, _libelle in Membre.ROLES)
ROLES_GESTION = (Membre.ADMIN, Membre.GESTIONNAIRE)   # tout sauf le scanner seul


def collectifs_geres(utilisateur, roles=ROLES_GESTION):
    """Les collectifs actifs que cette personne gère, dans un ordre stable."""
    return (Organisation.objects.filter(actif=True, membres__utilisateur=utilisateur, membres__role__in=roles)
            .distinct().order_by('nom', 'pk'))


def collectif_courant(utilisateur, id_demande=None, roles=ROLES_GESTION):
    """Le collectif sur lequel la personne travaille : celui qu'elle demande (s'il en fait partie), sinon son premier.
    404 si elle n'en gère aucun ou si celui demandé n'est pas le sien."""
    collectifs = collectifs_geres(utilisateur, roles)
    if id_demande not in (None, ''):
        pk = identifiant_entier(id_demande)
        collectif = collectifs.filter(pk=pk).first() if pk is not None else None
    else:
        collectif = collectifs.first()
    if collectif is None:
        raise NonTrouve()
    return collectif


def evenements_de(organisation):
    """Les événements du collectif, et eux seuls. Point de départ obligatoire des requêtes."""
    return Evenement.objects.filter(organisation=organisation)


def evenement_gere(utilisateur, evenement_id, roles=ROLES_GESTION):
    """L'événement s'il appartient à un collectif géré par cette personne, sinon 404 (même réponse partout)."""
    pk = identifiant_entier(evenement_id)
    if pk is None:
        raise NonTrouve()
    evenement = (Evenement.objects.filter(pk=pk, organisation__in=collectifs_geres(utilisateur, roles))
                 .select_related('organisation', 'lieu').first())
    if evenement is None:
        raise NonTrouve()
    return evenement
