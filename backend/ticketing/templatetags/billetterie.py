"""Filtres et balises de gabarit pour la billetterie."""
import re

from django import template
from django.utils.formats import number_format
from django.utils.html import conditional_escape
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter
def prix(centimes, devise=''):
    """2500 -> « 25 € », 1250 -> « 12,50 € » (séparateur selon la langue active)."""
    if centimes is None or centimes == '':
        return ''
    centimes = int(centimes)
    nombre = number_format(centimes / 100, decimal_pos=0 if centimes % 100 == 0 else 2, use_l10n=True)
    return f'{nombre}\u00a0{devise}'.strip()


@register.simple_tag
def titre_accent(texte):
    """Titre multi-lignes : une ligne de texte = une ligne du titre ; *mot* = mot en italique."""
    lignes = [ligne.strip() for ligne in (texte or '').splitlines() if ligne.strip()]
    morceaux = []
    for i, ligne in enumerate(lignes, 1):
        propre = re.sub(r'\*(.+?)\*', r'<em>\1</em>', str(conditional_escape(ligne)))   # texte échappé d'abord
        morceaux.append(f'<span class="rise" style="--i:{i}">{propre}</span>')
    return mark_safe(''.join(morceaux))


@register.filter
def accent(texte):
    """Texte sur une ligne : *mot* devient un mot en italique. Le reste est échappé."""
    return mark_safe(re.sub(r'\*(.+?)\*', r'<em>\1</em>', str(conditional_escape(texte or ''))))
