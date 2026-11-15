"""
Contrôle d'accès de l'espace organisateur : UN seul endroit décide qui entre.

Une vue protégée reçoit le slug de l'organisation dans l'adresse (/orga/<slug>/…). Le décorateur
(ou le mixin) charge l'organisation, vérifie que l'utilisateur en est membre avec un rôle
autorisé, puis place `request.organisation` et `request.membre`. Dans TOUS les autres cas
(organisation inconnue, inactive, utilisateur anonyme, non membre, mauvais rôle) la réponse
est la même 404 : on ne révèle pas qu'une organisation existe.

Règle pour les vues : ne jamais lire les données par identifiant seul. Toujours partir de
`evenements_de(request)` ou filtrer par `request.organisation`.
"""
from functools import wraps

from django.http import Http404

from .models import Evenement, Membre, Organisation

TOUS_LES_ROLES = tuple(role for role, _libelle in Membre.ROLES)
ROLES_GESTION = (Membre.ADMIN, Membre.GESTIONNAIRE)   # tout sauf le scanner seul


def _resoudre_organisation(request, slug, roles):
    """Place request.organisation / request.membre, ou lève une 404 identique dans tous les cas d'échec."""
    organisation = Organisation.objects.filter(slug=slug, actif=True).first()
    membre = None
    if organisation is not None and request.user.is_authenticated:
        membre = Membre.objects.filter(utilisateur=request.user, organisation=organisation, role__in=roles).first()
    if membre is None:
        raise Http404
    request.organisation, request.membre = organisation, membre


def organisation_requise(roles=None):
    """Décorateur : @organisation_requise(roles=[Membre.ADMIN, Membre.GESTIONNAIRE]).
    Sans `roles`, tous les rôles sont acceptés."""
    autorises = tuple(roles) if roles else TOUS_LES_ROLES

    def decorateur(vue):
        @wraps(vue)
        def enveloppe(request, *args, slug, **kwargs):
            _resoudre_organisation(request, slug, autorises)
            return vue(request, *args, **kwargs)
        return enveloppe
    return decorateur


class OrganisationRequiseMixin:
    """Équivalent pour les vues à base de classes : class MaVue(OrganisationRequiseMixin, View): roles = [...]"""
    roles = None

    def dispatch(self, request, *args, **kwargs):
        _resoudre_organisation(request, kwargs.pop('slug'), tuple(self.roles) if self.roles else TOUS_LES_ROLES)
        return super().dispatch(request, *args, **kwargs)


def evenements_de(request):
    """Les événements de l'organisation courante, et eux seuls. Point de départ obligatoire des requêtes."""
    return Evenement.objects.filter(organisation=request.organisation)
