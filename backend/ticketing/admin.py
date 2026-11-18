"""Administration : c'est ici que les vraies informations du site sont saisies."""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from . import images, models, services

admin.site.site_header = _('Administration de la billetterie')
admin.site.site_title = _('Billetterie')
admin.site.index_title = _('Gérer le site')


def _apercu(champ_image, hauteur=70):
    """Petite vignette d'une image téléversée, affichée dans la fiche."""
    def apercu(self, obj):
        image = getattr(obj, champ_image, None)
        if not image:
            return '—'
        return format_html('<img src="{}" alt="" style="max-height:{}px;border-radius:6px">', images.url_version(image, 'miniature'), hauteur)
    apercu.short_description = _('Aperçu')
    return apercu


# ---------------------------------------------------------------- Utilisateurs
@admin.register(models.Utilisateur)
class UtilisateurAdmin(UserAdmin):
    ordering = ('username',)
    list_display = ('username', 'email', 'first_name', 'last_name', 'email_verifie', 'is_staff', 'is_active')
    list_filter = ('email_verifie', 'is_staff', 'is_active')
    search_fields = ('username', 'email', 'first_name', 'last_name')
    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        (_('Informations personnelles'), {'fields': ('first_name', 'last_name', 'email', 'telephone', 'fuseau_horaire')}),
        (_('Compte'), {'fields': ('email_verifie', 'accepte_newsletter', 'cgv_acceptees_le')}),
        (_('Droits'), {'fields': ('is_active', 'is_staff', 'is_superuser', 'groups', 'user_permissions')}),
        (_('Dates'), {'fields': ('last_login', 'date_joined')}),
    )
    add_fieldsets = ((None, {'classes': ('wide',), 'fields': ('username', 'email', 'first_name', 'last_name', 'password1', 'password2')}),)


# ---------------------------------------------------------------- Organisations
class MembreInline(admin.TabularInline):
    model = models.Membre
    extra = 1
    autocomplete_fields = ('utilisateur',)


@admin.register(models.Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ('nom', 'slug', 'email_contact', 'actif')
    list_filter = ('actif',)
    search_fields = ('nom', 'slug')
    prepopulated_fields = {'slug': ('nom',)}
    readonly_fields = ('apercu_logo',)
    inlines = [MembreInline]
    apercu_logo = _apercu('logo')


# ---------------------------------------------------------------- Réglages du site
@admin.register(models.ParametresSite)
class ParametresSiteAdmin(admin.ModelAdmin):
    """Une seule fiche : on y accède directement, sans liste.

    Seuls les réglages encore utilisés sont proposés : l'interface du public est l'application, qui a son propre contenu.
    (Les anciens champs de l'interface web — texte de la page d'accueil, panneau de connexion, logo — existent encore dans
    la base mais ne servent plus ; ils seront retirés par une migration de nettoyage.)"""
    fieldsets = (
        (_('Identité'), {'fields': ('nom_site',), 'description': _("Le nom apparaît dans les e-mails envoyés (vérification, mot de passe oublié).")}),
        (_('Pages légales et e-mails'), {
            'description': _("Les CGV et la confidentialité se rédigent dans « Pages de texte ». Ici, on choisit celles que l'application propose à l'inscription."),
            'fields': ('page_cgv', 'page_confidentialite', 'email_expediteur_nom', 'email_signature')}),
        (_('Contact'), {'fields': ('email_contact', 'telephone_contact')}),
        (_('Règles'), {'fields': ('seuil_dernieres_places_pct', 'delai_annulation_defaut_heures')}),
    )

    def has_add_permission(self, request):
        return not models.ParametresSite.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        fiche = models.ParametresSite.objects.first()
        if fiche:
            cible = reverse('admin:ticketing_parametressite_change', args=[fiche.pk])
        else:
            cible = reverse('admin:ticketing_parametressite_add')
        return HttpResponseRedirect(cible)


# ---------------------------------------------------------------- Catalogue
@admin.register(models.Categorie)
class CategorieAdmin(admin.ModelAdmin):
    list_display = ('nom', 'pastille', 'ordre', 'actif')
    list_editable = ('ordre', 'actif')
    list_filter = ('actif',)
    search_fields = ('nom',)
    prepopulated_fields = {'slug': ('nom',)}
    readonly_fields = ('apercu_illustration',)
    fields = ('nom', 'slug', 'ordre', 'actif', 'couleur', 'illustration', 'apercu_illustration', 'illustration_alt')
    apercu_illustration = _apercu('illustration')

    @admin.display(description=_('Couleur'))
    def pastille(self, obj):
        if not obj.couleur:
            return '—'
        return format_html('<span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:{}"></span>', obj.couleur)


class ImageLieuInline(admin.TabularInline):
    model = models.ImageLieu
    extra = 1
    fields = ('apercu', 'image', 'alt', 'ordre')
    readonly_fields = ('apercu',)

    @admin.display(description=_('Aperçu'))
    def apercu(self, obj):
        if not obj.pk or not obj.image:
            return '—'
        return format_html('<img src="{}" alt="" style="max-height:60px;border-radius:6px">', images.url_version(obj.image, 'miniature'))


@admin.register(models.Lieu)
class LieuAdmin(admin.ModelAdmin):
    inlines = [ImageLieuInline]
    fields = ('nom', 'adresse', 'code_postal', 'ville', 'photo_principale', 'apercu_photo', 'photo_principale_alt')
    list_display = ('nom', 'ville', 'adresse')
    list_filter = ('ville',)
    search_fields = ('nom', 'ville', 'adresse')
    readonly_fields = ('apercu_photo',)
    apercu_photo = _apercu('photo_principale')


class TypePlaceInline(admin.TabularInline):
    model = models.TypePlace
    extra = 2
    fields = ('nom', 'capacite', 'prix_base_centimes', 'vendues', 'retenues')
    readonly_fields = ('vendues', 'retenues')
    show_change_link = True   # ouvre la fiche du type de place pour y saisir ses tarifs « early »


class ImageEvenementInline(admin.TabularInline):
    model = models.ImageEvenement
    extra = 1
    fields = ('apercu', 'image', 'alt', 'ordre')
    readonly_fields = ('apercu',)

    @admin.display(description=_('Aperçu'))
    def apercu(self, obj):
        if not obj.pk or not obj.image:
            return '—'
        return format_html('<img src="{}" alt="" style="max-height:60px;border-radius:6px">', images.url_version(obj.image, 'miniature'))


@admin.register(models.Evenement)
class EvenementAdmin(admin.ModelAdmin):
    list_display = ('titre', 'organisation', 'categorie', 'lieu', 'debut', 'publie', 'annule')
    list_filter = ('organisation', 'categorie', 'publie', 'annule', 'a_la_une', 'est_en_ligne')
    search_fields = ('titre', 'artiste', 'description', 'lieu__nom', 'lieu__ville')
    date_hierarchy = 'debut'
    prepopulated_fields = {'slug': ('titre',)}
    autocomplete_fields = ('lieu',)
    readonly_fields = ('apercu_image',)
    inlines = [TypePlaceInline, ImageEvenementInline]
    actions = ['publier', 'depublier', 'annuler']
    fieldsets = (
        (_('Description'), {'fields': ('organisation', 'titre', 'slug', 'artiste', 'categorie', 'description')}),
        (_('Images'), {'fields': ('image_principale', 'apercu_image', 'image_principale_alt'),
                       'description': _("La galerie se gère plus bas, dans « Images de l'événement ».")}),
        (_('Date et lieu'), {'fields': ('debut', 'ouverture_portes', 'fuseau_horaire', 'lieu', 'lieu_texte', 'est_en_ligne')}),
        (_('Vente'), {'fields': ('devise', 'date_limite_annulation', 'publie', 'annule', 'a_la_une'),
                      'description': _("Pour annuler un événement, utilisez l'action « Annuler les événements sélectionnés » : elle annule aussi les billets et marque les paiements à rembourser.")}),
    )
    apercu_image = _apercu('image_principale', 120)

    @admin.action(description=_('Publier les événements sélectionnés'))
    def publier(self, request, queryset):
        queryset.update(publie=True)

    @admin.action(description=_('Repasser en brouillon'))
    def depublier(self, request, queryset):
        queryset.update(publie=False)

    @admin.action(description=_('Annuler les événements sélectionnés (billets annulés, paiements à rembourser)'))
    def annuler(self, request, queryset):
        for evenement in queryset:
            services.annuler_evenement(evenement)


class TarifInline(admin.TabularInline):
    model = models.Tarif
    extra = 1


@admin.register(models.TypePlace)
class TypePlaceAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'capacite', 'vendues', 'retenues', 'prix_base_centimes')
    list_filter = ('evenement__organisation',)
    search_fields = ('nom', 'evenement__titre')
    readonly_fields = ('vendues', 'retenues')
    inlines = [TarifInline]


# ---------------------------------------------------------------- Ventes (lecture seule)
class LigneCommandeInline(admin.TabularInline):
    model = models.LigneCommande
    extra = 0
    can_delete = False
    readonly_fields = ('type_place', 'quantite', 'prix_unitaire_centimes')

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(models.Commande)
class CommandeAdmin(admin.ModelAdmin):
    list_display = ('id', 'email', 'evenement', 'statut', 'total_centimes', 'a_rembourser', 'cree_le')
    list_filter = ('statut', 'a_rembourser', 'evenement__organisation')
    search_fields = ('email', 'evenement__titre')
    inlines = [LigneCommandeInline]
    readonly_fields = ('evenement', 'utilisateur', 'email', 'moyen_paiement', 'total_centimes', 'cree_le', 'expire_le', 'payee_le')

    def has_add_permission(self, request):
        return False


@admin.register(models.Billet)
class BilletAdmin(admin.ModelAdmin):
    list_display = ('code', 'commande', 'type_place', 'statut', 'utilise_le')
    list_filter = ('statut', 'type_place__evenement')
    search_fields = ('code', 'commande__email')

    def has_add_permission(self, request):
        return False


@admin.register(models.Membre)
class MembreAdmin(admin.ModelAdmin):
    list_display = ('utilisateur', 'organisation', 'role')
    list_filter = ('role', 'organisation')
    search_fields = ('utilisateur__username', 'utilisateur__email', 'organisation__nom')
    autocomplete_fields = ('utilisateur',)


@admin.register(models.PageLegale)
class PageLegaleAdmin(admin.ModelAdmin):
    list_display = ('titre', 'slug', 'publiee', 'modifiee_le')
    list_filter = ('publiee',)
    search_fields = ('titre', 'contenu')
    prepopulated_fields = {'slug': ('titre',)}


@admin.register(models.JetonApi)
class JetonApiAdmin(admin.ModelAdmin):
    """Les appareils connectés à l'application. On ne peut que les consulter et les supprimer (= déconnecter l'appareil)."""
    list_display = ('utilisateur', 'appareil', 'cree_le', 'derniere_utilisation', 'expire_le')
    search_fields = ('utilisateur__username', 'utilisateur__email')
    list_filter = ('utilisateur',)
    readonly_fields = ('utilisateur', 'appareil', 'cree_le', 'derniere_utilisation', 'expire_le')
    exclude = ('empreinte',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
