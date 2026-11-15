"""Formulaires de l'espace organisateur : images d'un événement (image principale et galerie)."""
from django import forms
from django.forms import modelformset_factory
from django.utils.translation import gettext_lazy as _

from .models import Evenement, ImageEvenement

# data-apercu : le JavaScript affiche l'aperçu de l'image choisie avant l'envoi (voir assets/js/orga.js)
ATTRIBUTS_FICHIER = {'accept': 'image/jpeg,image/png,image/webp', 'data-apercu': '1'}


class FormulaireImagePrincipale(forms.ModelForm):
    """Image principale d'un événement : la remplacer, modifier son texte alternatif, ou la supprimer."""
    supprimer = forms.BooleanField(required=False, label=_("Supprimer l'image principale"))

    class Meta:
        model = Evenement
        fields = ('image_principale', 'image_principale_alt')
        widgets = {
            'image_principale': forms.FileInput(attrs=ATTRIBUTS_FICHIER),
            'image_principale_alt': forms.TextInput(attrs={'maxlength': 150}),
        }

    def clean(self):
        donnees = super().clean()
        if donnees.get('supprimer'):
            donnees['image_principale'] = False   # « False » = effacer, pour un champ fichier de Django
            donnees['image_principale_alt'] = ''
        return donnees


class FormulaireAjoutGalerie(forms.ModelForm):
    """Ajout d'une image à la galerie. Le texte alternatif est obligatoire."""

    class Meta:
        model = ImageEvenement
        fields = ('image', 'alt')
        widgets = {'image': forms.FileInput(attrs=ATTRIBUTS_FICHIER), 'alt': forms.TextInput(attrs={'maxlength': 150})}


# Images déjà dans la galerie : texte alternatif, suppression et ordre (champ caché, mis à jour par le JavaScript).
FormSetGalerie = modelformset_factory(
    ImageEvenement, fields=('alt', 'ordre'), extra=0, can_delete=True,
    widgets={'ordre': forms.HiddenInput(), 'alt': forms.TextInput(attrs={'maxlength': 150})})
