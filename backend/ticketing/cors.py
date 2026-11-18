"""CORS pour l'API de l'application (/api/v1/).

Un navigateur ne laisse une page lire la réponse d'une API située sur un autre site que si cette API l'y autorise,
en-tête par en-tête. Cela ne concerne que la version WEB de l'application : un téléphone n'est pas un navigateur et
n'est pas soumis à cette règle.

Règles :
- seules les origines de CORS_ORIGINES_AUTORISEES (liste exacte, jamais « * ») reçoivent les en-têtes ;
- le jeton d'accès voyagera dans l'en-tête Authorization et non dans un cookie : on n'autorise donc jamais les
  « credentials » (Access-Control-Allow-Credentials n'est jamais envoyé) ;
- les autres adresses (l'administration, par exemple) ne sont pas concernées : seul /api/v1/ est ouvert à l'application.
"""
from django.conf import settings
from django.http import HttpResponse
from django.utils.cache import patch_vary_headers

PREFIXE_API = '/api/v1/'
METHODES_AUTORISEES = 'GET, POST, PUT, DELETE, OPTIONS'
EN_TETES_AUTORISES = 'Authorization, Content-Type, Accept-Language'
DUREE_PREVERIFICATION_SECONDES = '600'   # le navigateur peut réutiliser la réponse de « pré-vérification » 10 minutes


class CorsApiMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path.startswith(PREFIXE_API):
            return self.get_response(request)

        origine = request.headers.get('Origin', '')
        autorisee = origine in settings.CORS_ORIGINES_AUTORISEES   # lue à chaque requête (et non à l'import) : testable
        preverification = request.method == 'OPTIONS' and 'Access-Control-Request-Method' in request.headers

        if autorisee and preverification:
            reponse = HttpResponse(status=204)   # le navigateur demande la permission avant la vraie requête : on répond ici
        else:
            reponse = self.get_response(request)

        patch_vary_headers(reponse, ('Origin',))   # la réponse dépend de l'origine : un cache ne doit pas la partager
        if autorisee:
            reponse['Access-Control-Allow-Origin'] = origine
            if preverification:
                reponse['Access-Control-Allow-Methods'] = METHODES_AUTORISEES
                reponse['Access-Control-Allow-Headers'] = EN_TETES_AUTORISES
                reponse['Access-Control-Max-Age'] = DUREE_PREVERIFICATION_SECONDES
        return reponse
