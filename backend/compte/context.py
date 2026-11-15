"""Données communes aux pages : indique si l'utilisateur connecté doit encore vérifier son e-mail."""


def verification(request):
    utilisateur = getattr(request, 'user', None)
    return {'email_a_verifier': bool(utilisateur and utilisateur.is_authenticated and not utilisateur.email_verifie)}
