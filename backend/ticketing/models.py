"""
Modèles de la billetterie.

Tout ce qui s'affiche sur le site vient d'ici (saisi dans l'admin) : aucun événement, texte
ou coordonnée n'est écrit dans le code.
"""
import secrets
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.core.exceptions import ValidationError
from django.core.validators import (FileExtensionValidator, MaxValueValidator, MinLengthValidator, MinValueValidator,
                                    RegexValidator)
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _

from .images import valider_image


def valider_fuseau(valeur):
    try:
        ZoneInfo(valeur)
    except Exception:
        raise ValidationError(_("« %(v)s » n'est pas un fuseau horaire valide (ex. Europe/Paris)."), params={'v': valeur})


def fuseau_par_defaut():
    return settings.TIME_ZONE


valider_logo = FileExtensionValidator(['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'])   # le SVG est accepté (ImageField le refuserait)
valider_couleur = RegexValidator(r'^#[0-9a-fA-F]{6}$', _('Couleur au format #RRGGBB (ex. #5a1b9e).'))


def exiger_alt(instance, champ_image, champ_alt):
    """Une image doit toujours avoir un texte alternatif (accessibilité, référencement)."""
    if getattr(instance, champ_image) and not (getattr(instance, champ_alt) or '').strip():   # espaces seuls = vide
        raise ValidationError({champ_alt: _("Décrivez l'image en quelques mots : le texte alternatif est obligatoire.")})


def exiger_alt_galerie(instance):
    """Image de galerie : le texte alternatif est toujours obligatoire (et pas seulement des espaces)."""
    if not (instance.alt or '').strip():
        raise ValidationError({'alt': _("Décrivez l'image en quelques mots : le texte alternatif est obligatoire.")})


# Nom d'utilisateur (le « surnom » avec lequel on se connecte) : lettres, chiffres, point, tiret, tiret bas.
# Pas d'arobase ni d'espace : on évite qu'un nom ressemble à une adresse e-mail ou à celui de quelqu'un d'autre.
valider_nom_utilisateur = [
    MinLengthValidator(3, message=_("Le nom d'utilisateur doit faire au moins 3 caractères.")),
    RegexValidator(r'^[\w.-]+$', message=_("Lettres, chiffres, point, tiret et tiret bas uniquement, sans espace.")),
]


def _slug_unique(modele, base, instance):
    """Slug à partir de `base`, rendu unique en ajoutant -2, -3… si besoin."""
    racine = slugify(base)[:60] or 'element'
    slug, n = racine, 2
    while modele.objects.filter(slug=slug).exclude(pk=instance.pk).exists():
        slug, n = f'{racine}-{n}', n + 1
    return slug


# ======================================================================================
# Utilisateurs, organisations et rôles
# ======================================================================================
class GestionnaireUtilisateurs(BaseUserManager):
    use_in_migrations = True

    def get_by_natural_key(self, nom_utilisateur):
        """Connexion insensible à la casse : « Anna » et « anna » désignent le même compte."""
        return self.get(**{f'{self.model.USERNAME_FIELD}__iexact': nom_utilisateur})

    def _creer(self, nom_utilisateur, email, password, **extra):
        if not nom_utilisateur:
            raise ValueError(_("Le nom d'utilisateur est obligatoire."))
        if not email:
            raise ValueError(_("L'adresse e-mail est obligatoire."))
        utilisateur = self.model(username=self.model.normalize_username(nom_utilisateur.strip()),
                                 email=self.normalize_email(email).lower(), **extra)
        utilisateur.set_password(password)
        utilisateur.save(using=self._db)
        return utilisateur

    def create_user(self, username=None, email=None, password=None, **extra):
        extra.setdefault('is_staff', False)
        extra.setdefault('is_superuser', False)
        return self._creer(username, email, password, **extra)

    def create_superuser(self, username=None, email=None, password=None, **extra):
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        extra.setdefault('email_verifie', True)   # le premier administrateur n'a pas de lien à cliquer
        return self._creer(username, email, password, **extra)


class Utilisateur(AbstractUser):
    """Compte utilisateur : on se connecte avec son nom d'utilisateur ; l'e-mail sert à vérifier le compte et à récupérer le mot de passe."""
    username = models.CharField(
        _("nom d'utilisateur"), max_length=30, unique=True, validators=valider_nom_utilisateur,
        error_messages={'unique': _("Ce nom d'utilisateur est déjà pris.")},
        help_text=_("3 à 30 caractères : lettres, chiffres, point, tiret et tiret bas. Sans espace."))
    email = models.EmailField(_('adresse e-mail'), unique=True)
    telephone = models.CharField(_('téléphone'), max_length=30, blank=True)
    fuseau_horaire = models.CharField(_('fuseau horaire'), max_length=64, default=fuseau_par_defaut, validators=[valider_fuseau])
    email_verifie = models.BooleanField(_('e-mail vérifié'), default=False, help_text=_('Obligatoire pour payer.'))
    accepte_newsletter = models.BooleanField(_('accepte les alertes et la newsletter'), default=False)
    cgv_acceptees_le = models.DateTimeField(_('CGV et confidentialité acceptées le'), null=True, blank=True)

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email']
    objects = GestionnaireUtilisateurs()

    class Meta:
        verbose_name = _('utilisateur')
        verbose_name_plural = _('utilisateurs')
        constraints = [
            models.UniqueConstraint(Lower('email'), name='email_unique_sans_casse'),   # « A@x.fr » et « a@x.fr » = même adresse
            models.UniqueConstraint(Lower('username'), name='nom_utilisateur_unique_sans_casse'),   # « Anna » et « anna » aussi
        ]

    def __str__(self):
        return self.username or self.email


class Organisation(models.Model):
    """Un collectif qui vend ses événements. Ses données sont invisibles pour les autres collectifs."""
    nom = models.CharField(_('nom'), max_length=120)
    slug = models.SlugField(_('identifiant dans les adresses'), unique=True)
    logo = models.FileField(_('logo'), upload_to='organisations/', blank=True, validators=[valider_logo])
    email_contact = models.EmailField(_('e-mail de contact'), blank=True)
    actif = models.BooleanField(_('actif'), default=True)

    class Meta:
        verbose_name = _('organisation')
        verbose_name_plural = _('organisations')
        ordering = ['nom']

    def __str__(self):
        return self.nom


class Membre(models.Model):
    ADMIN, GESTIONNAIRE, CONTROLEUR = 'admin', 'gestionnaire', 'controleur'
    ROLES = [
        (ADMIN, _('Administrateur')),           # tout gérer, y compris les membres
        (GESTIONNAIRE, _('Gestionnaire')),      # événements, chiffres, export
        (CONTROLEUR, _('Contrôleur')),          # uniquement le scanner d'entrée
    ]
    utilisateur = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='adhesions', verbose_name=_('utilisateur'))
    organisation = models.ForeignKey(Organisation, on_delete=models.CASCADE, related_name='membres', verbose_name=_('organisation'))
    role = models.CharField(_('rôle'), max_length=12, choices=ROLES, default=GESTIONNAIRE)

    class Meta:
        verbose_name = _('membre')
        verbose_name_plural = _('membres')
        constraints = [models.UniqueConstraint(fields=['utilisateur', 'organisation'], name='un_role_par_utilisateur_et_organisation')]

    def __str__(self):
        return f'{self.utilisateur} · {self.organisation} · {self.get_role_display()}'


class PageLegale(models.Model):
    """Page de texte saisie dans l'admin : CGV, politique de confidentialité, mentions légales…"""
    titre = models.CharField(_('titre'), max_length=200)
    slug = models.SlugField(_('identifiant dans les adresses'), unique=True, blank=True)
    contenu = models.TextField(_('contenu'), blank=True, help_text=_('Les retours à la ligne sont conservés.'))
    publiee = models.BooleanField(_('publiée'), default=True)
    modifiee_le = models.DateTimeField(_('dernière modification'), auto_now=True)

    class Meta:
        verbose_name = _('page de texte (CGV, confidentialité…)')
        verbose_name_plural = _('pages de texte (CGV, confidentialité…)')
        ordering = ['titre']

    def __str__(self):
        return self.titre

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = _slug_unique(PageLegale, self.titre, self)
        super().save(*args, **kwargs)


# ======================================================================================
# Réglages du site (une seule fiche, modifiable dans l'admin)
# ======================================================================================
class ParametresSite(models.Model):
    """Textes, coordonnées et réglages du site. Un champ vide = l'élément n'est pas affiché."""
    nom_site = models.CharField(_('nom du site'), max_length=80, blank=True)
    logo = models.FileField(_('logo'), upload_to='site/', blank=True, validators=[valider_logo], help_text=_('SVG, PNG ou JPG.'))
    favicon = models.FileField(_("icône de l'onglet (favicon)"), upload_to='site/', blank=True, validators=[valider_logo], help_text=_('SVG, PNG ou ICO.'))
    meta_description = models.CharField(_('description pour les moteurs de recherche'), max_length=300, blank=True)

    hero_titre = models.TextField(
        _("titre de la page d'accueil"), blank=True,
        help_text=_('Une ligne de texte par ligne du titre. Entourez de *étoiles* les mots à mettre en italique.'))
    hero_texte = models.TextField(_('paragraphe sous le titre'), blank=True)
    hero_annotation = models.CharField(_('petite annotation près du bouton'), max_length=120, blank=True)
    hero_image = models.ImageField(_("grande image de l'accueil"), upload_to='site/', blank=True)
    hero_image_alt = models.CharField(_("description de l'image (accessibilité)"), max_length=200, blank=True)
    titre_a_la_une = models.CharField(_('titre de la section « à la une »'), max_length=120, blank=True)

    # Pages de connexion et d'inscription : tout est facultatif, un champ vide n'est pas affiché
    image_auth = models.ImageField(_('image du panneau des pages de compte'), upload_to='site/', blank=True)
    image_auth_alt = models.CharField(_("description de l'image (accessibilité)"), max_length=200, blank=True)
    auth_connexion_titre = models.CharField(_('titre de la page de connexion'), max_length=120, blank=True,
                                            help_text=_('Entourez de *étoiles* le mot à mettre en italique.'))
    auth_connexion_sous_titre = models.CharField(_('sous-titre de la page de connexion'), max_length=200, blank=True)
    auth_inscription_titre = models.CharField(_("titre de la page d'inscription"), max_length=120, blank=True,
                                              help_text=_('Entourez de *étoiles* le mot à mettre en italique.'))
    auth_inscription_sous_titre = models.CharField(_("sous-titre de la page d'inscription"), max_length=200, blank=True)
    auth_arguments = models.TextField(_('avantages du compte'), blank=True,
                                      help_text=_('Un avantage par ligne (2 ou 3 courts). Affichés à côté du formulaire.'))

    page_cgv = models.ForeignKey(PageLegale, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
                                 verbose_name=_('page des CGV'), help_text=_("Liée à la case « J'accepte » de l'inscription."))
    page_confidentialite = models.ForeignKey(PageLegale, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
                                             verbose_name=_('page de la politique de confidentialité'))

    email_expediteur_nom = models.CharField(_("nom de l'expéditeur des e-mails"), max_length=100, blank=True,
                                            help_text=_('Vide : le nom du site est utilisé.'))
    email_signature = models.TextField(_('signature des e-mails'), blank=True, help_text=_('Affichée en bas des e-mails. Vide : pas de signature.'))

    email_contact = models.EmailField(_('e-mail de contact'), blank=True)
    telephone_contact = models.CharField(_('téléphone de contact'), max_length=30, blank=True)

    devise = models.CharField(_('symbole de la monnaie'), max_length=4, default='€')
    seuil_dernieres_places_pct = models.PositiveSmallIntegerField(
        _('seuil « dernières places » (%)'), default=20, validators=[MinValueValidator(1), MaxValueValidator(100)],
        help_text=_('Le badge « Plus que X places » apparaît quand il reste moins de ce pourcentage de places.'))
    delai_annulation_defaut_heures = models.PositiveIntegerField(
        _("délai d'annulation par défaut (heures avant l'événement)"), default=24,
        help_text=_("Utilisé pour les événements sans date limite d'annulation propre."))
    nombre_evenements_a_la_une = models.PositiveSmallIntegerField(_("nombre d'événements à la une"), default=6)
    nombre_categories_barre = models.PositiveSmallIntegerField(_('nombre de catégories dans la barre de navigation'), default=4)

    class Meta:
        verbose_name = _('paramètres du site')
        verbose_name_plural = _('paramètres du site')

    def __str__(self):
        return str(_('Paramètres du site'))

    def save(self, *args, **kwargs):
        self.pk = 1   # une seule fiche
        kwargs['force_insert'] = False   # un second « create » met à jour la fiche au lieu d'échouer
        super().save(*args, **kwargs)

    @classmethod
    def charger(cls):
        """La fiche enregistrée, ou une fiche vide (non enregistrée) : le site marche même sans rien saisir."""
        return cls.objects.filter(pk=1).first() or cls()


# ======================================================================================
# Catalogue : catégories, lieux, événements, places, tarifs
# ======================================================================================
class Categorie(models.Model):
    nom = models.CharField(_('nom'), max_length=80)
    slug = models.SlugField(_('identifiant dans les adresses'), unique=True, blank=True)
    ordre = models.PositiveSmallIntegerField(_("ordre d'affichage"), default=0)
    actif = models.BooleanField(_('actif'), default=True)
    couleur = models.CharField(_('couleur'), max_length=7, blank=True, validators=[valider_couleur],
                               help_text=_('Format #RRGGBB. Sert de fond aux cartes sans image.'))
    illustration = models.ImageField(_('illustration'), upload_to='categories/', blank=True, validators=[valider_image],
                                     width_field='illustration_largeur', height_field='illustration_hauteur',
                                     help_text=_('Affichée sur les cartes des événements de cette catégorie qui n\'ont pas d\'image.'))
    illustration_alt = models.CharField(_("description de l'illustration"), max_length=150, blank=True)
    illustration_largeur = models.PositiveIntegerField(null=True, blank=True, editable=False)
    illustration_hauteur = models.PositiveIntegerField(null=True, blank=True, editable=False)

    class Meta:
        verbose_name = _('catégorie')
        verbose_name_plural = _('catégories')
        ordering = ['ordre', 'nom']

    def __str__(self):
        return self.nom

    def clean(self):
        exiger_alt(self, 'illustration', 'illustration_alt')

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = _slug_unique(Categorie, self.nom, self)
        super().save(*args, **kwargs)


class Lieu(models.Model):
    nom = models.CharField(_('nom'), max_length=120)
    adresse = models.CharField(_('adresse'), max_length=200, blank=True)
    code_postal = models.CharField(_('code postal'), max_length=10, blank=True)
    ville = models.CharField(_('ville'), max_length=80)
    photo_principale = models.ImageField(_('photo principale'), upload_to='lieux/', blank=True, validators=[valider_image],
                                         width_field='photo_principale_largeur', height_field='photo_principale_hauteur')
    photo_principale_alt = models.CharField(_('description de la photo'), max_length=150, blank=True)
    photo_principale_largeur = models.PositiveIntegerField(null=True, blank=True, editable=False)
    photo_principale_hauteur = models.PositiveIntegerField(null=True, blank=True, editable=False)

    class Meta:
        verbose_name = _('lieu')
        verbose_name_plural = _('lieux')
        ordering = ['nom']

    def __str__(self):
        return f'{self.nom} ({self.ville})'

    def clean(self):
        exiger_alt(self, 'photo_principale', 'photo_principale_alt')


class ImageLieu(models.Model):
    """Image de la galerie d'un lieu."""
    lieu = models.ForeignKey(Lieu, on_delete=models.CASCADE, related_name='galerie', verbose_name=_('lieu'))
    image = models.ImageField(_('image'), upload_to='lieux/galerie/', validators=[valider_image],
                              width_field='largeur', height_field='hauteur')
    alt = models.CharField(_('description de l\'image'), max_length=150, help_text=_('Obligatoire.'))
    ordre = models.PositiveSmallIntegerField(_('ordre'), default=0)
    largeur = models.PositiveIntegerField(null=True, blank=True, editable=False)
    hauteur = models.PositiveIntegerField(null=True, blank=True, editable=False)

    class Meta:
        verbose_name = _('image du lieu')
        verbose_name_plural = _('images du lieu')
        ordering = ['ordre', 'pk']

    def __str__(self):
        return self.alt

    def clean(self):
        exiger_alt_galerie(self)


class EvenementQuerySet(models.QuerySet):
    def publies_a_venir(self, maintenant=None):
        return self.filter(publie=True, debut__gt=maintenant or timezone.now())


class Evenement(models.Model):
    organisation = models.ForeignKey(Organisation, on_delete=models.PROTECT, related_name='evenements', verbose_name=_('organisation'))
    titre = models.CharField(_('titre'), max_length=200)
    slug = models.SlugField(_('identifiant dans les adresses'), unique=True, blank=True)
    artiste = models.CharField(_('artiste ou intervenant'), max_length=120, blank=True)
    categorie = models.ForeignKey(Categorie, null=True, blank=True, on_delete=models.SET_NULL, related_name='evenements', verbose_name=_('catégorie'))
    lieu = models.ForeignKey(Lieu, null=True, blank=True, on_delete=models.SET_NULL, related_name='evenements', verbose_name=_('lieu'))
    est_en_ligne = models.BooleanField(_('événement en ligne'), default=False)
    description = models.TextField(_('description'), blank=True)
    image_principale = models.ImageField(_('image principale'), upload_to='evenements/', blank=True, validators=[valider_image],
                                         width_field='image_principale_largeur', height_field='image_principale_hauteur')
    image_principale_alt = models.CharField(_("description de l'image"), max_length=150, blank=True)
    image_principale_largeur = models.PositiveIntegerField(null=True, blank=True, editable=False)
    image_principale_hauteur = models.PositiveIntegerField(null=True, blank=True, editable=False)
    debut = models.DateTimeField(_('début'), help_text=_("Saisi dans le fuseau horaire de l'administrateur, stocké en UTC."))
    fuseau_horaire = models.CharField(_('fuseau horaire du lieu'), max_length=64, default=fuseau_par_defaut, validators=[valider_fuseau])
    date_limite_annulation = models.DateTimeField(_("date limite d'annulation"), null=True, blank=True,
                                                  help_text=_("Vide : on utilise le délai par défaut des paramètres du site."))
    publie = models.BooleanField(_('publié'), default=False)
    a_la_une = models.BooleanField(_('à la une'), default=False)

    objects = EvenementQuerySet.as_manager()

    class Meta:
        verbose_name = _('événement')
        verbose_name_plural = _('événements')
        ordering = ['debut']

    def __str__(self):
        return self.titre

    def clean(self):
        exiger_alt(self, 'image_principale', 'image_principale_alt')

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = _slug_unique(Evenement, self.titre, self)
        super().save(*args, **kwargs)

    @property
    def debut_local(self):
        """Début dans le fuseau horaire du lieu."""
        return self.debut.astimezone(ZoneInfo(self.fuseau_horaire))

    @property
    def limite_annulation(self):
        if self.date_limite_annulation:
            return self.date_limite_annulation
        return self.debut - timedelta(hours=ParametresSite.charger().delai_annulation_defaut_heures)


class ImageEvenement(models.Model):
    """Image de la galerie d'un événement (en plus de l'image principale)."""
    evenement = models.ForeignKey(Evenement, on_delete=models.CASCADE, related_name='galerie', verbose_name=_('événement'))
    image = models.ImageField(_('image'), upload_to='evenements/galerie/', validators=[valider_image],
                              width_field='largeur', height_field='hauteur')
    alt = models.CharField(_("description de l'image"), max_length=150, help_text=_('Obligatoire.'))
    ordre = models.PositiveSmallIntegerField(_('ordre'), default=0)
    largeur = models.PositiveIntegerField(null=True, blank=True, editable=False)
    hauteur = models.PositiveIntegerField(null=True, blank=True, editable=False)

    class Meta:
        verbose_name = _("image de l'événement")
        verbose_name_plural = _("images de l'événement")
        ordering = ['ordre', 'pk']

    def __str__(self):
        return self.alt

    def clean(self):
        exiger_alt_galerie(self)


class TypePlace(models.Model):
    """Catégorie de places d'un événement. `vendues` + `retenues` ne peut jamais dépasser `capacite`."""
    evenement = models.ForeignKey(Evenement, on_delete=models.CASCADE, related_name='types_place', verbose_name=_('événement'))
    nom = models.CharField(_('nom'), max_length=80)
    capacite = models.PositiveIntegerField(_('nombre de places'))
    vendues = models.PositiveIntegerField(_('vendues'), default=0, editable=False)
    retenues = models.PositiveIntegerField(_('réservées non payées'), default=0, editable=False)
    prix_base_centimes = models.PositiveIntegerField(_('prix normal (en centimes)'), help_text=_('2500 = 25,00. 0 = gratuit.'))

    class Meta:
        verbose_name = _('type de place')
        verbose_name_plural = _('types de place')
        constraints = [
            models.CheckConstraint(condition=Q(vendues__lte=F('capacite') - F('retenues')), name='type_place_jamais_survendu'),
        ]

    @property
    def disponibles(self):
        return self.capacite - self.vendues - self.retenues

    def prix_a(self, quand, tarifs=None):
        """Prix en vigueur : le tarif « early » le plus proche encore valide, sinon le prix normal."""
        tarifs = self.tarifs.all() if tarifs is None else tarifs
        valides = [t for t in tarifs if t.valide_jusqua > quand]
        return min(valides, key=lambda t: t.valide_jusqua).prix_centimes if valides else self.prix_base_centimes

    def __str__(self):
        return f'{self.evenement} – {self.nom}'


class Tarif(models.Model):
    """Tarif « early » : s'applique jusqu'à la date indiquée, puis le prix normal reprend."""
    type_place = models.ForeignKey(TypePlace, on_delete=models.CASCADE, related_name='tarifs', verbose_name=_('type de place'))
    prix_centimes = models.PositiveIntegerField(_('prix (en centimes)'))
    valide_jusqua = models.DateTimeField(_("valable jusqu'au"))

    class Meta:
        verbose_name = _('tarif early')
        verbose_name_plural = _('tarifs early')
        ordering = ['valide_jusqua']

    def __str__(self):
        return f'{self.type_place} – {self.prix_centimes / 100:.2f}'


# ======================================================================================
# Commandes, billets et paiements
# ======================================================================================
class Commande(models.Model):
    EN_ATTENTE, PAYEE, EXPIREE, ANNULEE = 'en_attente', 'payee', 'expiree', 'annulee'
    STATUTS = [(EN_ATTENTE, _('En attente')), (PAYEE, _('Payée')), (EXPIREE, _('Expirée')), (ANNULEE, _('Annulée'))]

    evenement = models.ForeignKey(Evenement, on_delete=models.PROTECT, related_name='commandes', verbose_name=_('événement'))
    email = models.EmailField(_('e-mail'))
    statut = models.CharField(_('statut'), max_length=10, choices=STATUTS, default=EN_ATTENTE, db_index=True)
    moyen_paiement = models.CharField(_('moyen de paiement'), max_length=10, default='carte')
    total_centimes = models.PositiveIntegerField(_('total (centimes)'), default=0)
    cree_le = models.DateTimeField(_('créée le'), auto_now_add=True)
    expire_le = models.DateTimeField(_('expire le'), db_index=True)
    payee_le = models.DateTimeField(_('payée le'), null=True, blank=True)
    a_rembourser = models.BooleanField(_('à rembourser'), default=False,
                                       help_text=_("Paiement reçu après expiration, alors qu'il n'y avait plus de place."))

    class Meta:
        verbose_name = _('commande')
        verbose_name_plural = _('commandes')
        ordering = ['-cree_le']


class LigneCommande(models.Model):
    commande = models.ForeignKey(Commande, on_delete=models.CASCADE, related_name='lignes')
    type_place = models.ForeignKey(TypePlace, on_delete=models.PROTECT)
    quantite = models.PositiveIntegerField()
    prix_unitaire_centimes = models.PositiveIntegerField()   # prix figé à la réservation


def _nouveau_code():
    return secrets.token_urlsafe(18)


class Billet(models.Model):
    VALIDE, UTILISE, ANNULE = 'valide', 'utilise', 'annule'
    commande = models.ForeignKey(Commande, on_delete=models.CASCADE, related_name='billets')
    type_place = models.ForeignKey(TypePlace, on_delete=models.PROTECT)
    numero = models.PositiveIntegerField()   # n° du billet dans la commande
    code = models.CharField(max_length=40, unique=True, default=_nouveau_code)   # contenu du QR code
    statut = models.CharField(max_length=10, default=VALIDE)
    utilise_le = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = _('billet')
        verbose_name_plural = _('billets')
        # Garde-fou : un paiement rejoué ne peut pas créer un second billet.
        constraints = [models.UniqueConstraint(fields=['commande', 'numero'], name='un_numero_par_commande')]


class NotificationPaiement(models.Model):
    """Journal des notifications du prestataire. L'unicité de l'identifiant rend le traitement idempotent."""
    id_fournisseur = models.CharField(max_length=120, unique=True)
    commande = models.ForeignKey(Commande, on_delete=models.PROTECT, null=True)
    montant_centimes = models.PositiveIntegerField()
    recue_le = models.DateTimeField(auto_now_add=True)
