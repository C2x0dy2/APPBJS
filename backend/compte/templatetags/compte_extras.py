"""Balises de gabarit des formulaires de compte."""
from django import template
from django.utils.safestring import mark_safe

register = template.Library()


@register.simple_tag
def champ(champ_formulaire, **attributs):
    """Affiche un champ avec les attributs d'accessibilité : si le champ a une erreur,
    aria-invalid="true" et aria-describedby pointent vers le message (id = <id du champ>-erreur)."""
    attrs = {'class': 'champ'}
    attrs.update({nom.replace('_', '-'): valeur for nom, valeur in attributs.items()})   # data_x devient data-x
    decrit_par = []   # le lecteur d'écran annonce l'erreur puis l'aide, quand elles existent
    if champ_formulaire.errors:
        attrs['aria-invalid'] = 'true'
        decrit_par.append(f'{champ_formulaire.auto_id}-erreur')
    if champ_formulaire.help_text:
        decrit_par.append(f'{champ_formulaire.auto_id}-aide')
    if decrit_par:
        attrs['aria-describedby'] = ' '.join(decrit_par)
    return mark_safe(champ_formulaire.as_widget(attrs=attrs))


@register.filter
def lignes(texte):
    """Texte multi-lignes -> liste de lignes non vides (ex. les avantages du compte)."""
    return [ligne.strip() for ligne in (texte or '').splitlines() if ligne.strip()]
