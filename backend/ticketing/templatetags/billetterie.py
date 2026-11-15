"""Filtres et balises de gabarit pour la billetterie."""
import re

from django import template
from django.utils.formats import number_format
from django.utils.html import conditional_escape, format_html
from django.utils.safestring import mark_safe

from ticketing import images

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


@register.simple_tag
def image_responsive(objet, champ, sizes='100vw', classe='', priorite=False, alt=None):
    """Affiche une image avec ses versions WebP : <img srcset=… sizes=… loading="lazy">.

    {% image_responsive evenement "image_principale" sizes="(min-width: 900px) 900px, 100vw" priorite=True %}

    - `sizes` dit au navigateur quelle largeur l'image occupera : il choisit alors la plus petite version suffisante.
    - Chargement différé (lazy) par défaut ; `priorite=True` pour l'image principale visible dès l'arrivée (pas de lazy).
    - Le texte alternatif vient de `<champ>_alt` (image principale), sinon de `alt` (images de galerie).
    - Rien n'est affiché s'il n'y a pas d'image (l'appelant prévoit la solution de repli).
    """
    fichier = getattr(objet, champ, None)
    if not fichier:
        return ''
    if alt is None:
        alt = getattr(objet, f'{champ}_alt', None) or getattr(objet, 'alt', '') or ''
    nom_largeur = getattr(objet._meta.get_field(champ), 'width_field', None)
    nom_hauteur = getattr(objet._meta.get_field(champ), 'height_field', None)
    largeur = getattr(objet, nom_largeur, None) if nom_largeur else None
    hauteur = getattr(objet, nom_hauteur, None) if nom_hauteur else None
    chargement = {'fetchpriority': 'high'} if priorite else {'loading': 'lazy'}
    attributs = format_html(' {}="{}"', *next(iter(chargement.items())))
    if largeur and hauteur:
        liste = images.versions(fichier.name, largeur)
        srcset = ', '.join(f'{fichier.storage.url(nom)} {l}w' for l, nom in liste)
        milieu = liste[len(liste) // 2][1]
        return format_html(
            '<img src="{}" srcset="{}" sizes="{}" alt="{}" width="{}" height="{}" class="{}" decoding="async"{}>',
            fichier.storage.url(milieu), srcset, sizes, alt, largeur, hauteur, classe, attributs)
    return format_html('<img src="{}" alt="{}" class="{}" decoding="async"{}>', fichier.url, alt, classe, attributs)
