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
    if champ_formulaire.errors:
        attrs['aria-invalid'] = 'true'
        attrs['aria-describedby'] = f'{champ_formulaire.auto_id}-erreur'
    return mark_safe(champ_formulaire.as_widget(attrs=attrs))


@register.filter
def lignes(texte):
    """Texte multi-lignes -> liste de lignes non vides (ex. les avantages du compte)."""
    return [ligne.strip() for ligne in (texte or '').splitlines() if ligne.strip()]
