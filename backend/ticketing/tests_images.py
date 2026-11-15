"""
Tests des images : validation à l'upload, alt obligatoire, versions WebP, suppression des fichiers, affichage
(srcset, lazy, solutions de repli) et gestion dans l'espace organisateur. Chaque test crée ses données, dans
un dossier temporaire qui est effacé à la fin (jamais le vrai dossier des médias).
"""
import json
import shutil
import tempfile

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from . import images
from .fabriques import creer_evenement, creer_image, creer_organisation, creer_utilisateur
from .images import valider_image
from .models import Categorie, Evenement, ImageEvenement, ImageLieu, Lieu, Membre

HACHAGE_RAPIDE = override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'])


class StockageTemporaire(TestCase):
    """Les fichiers de ces tests vont dans un dossier jetable. Les opérations différées (versions WebP,
    suppressions) sont exécutées tout de suite grâce à captureOnCommitCallbacks."""

    @classmethod
    def setUpClass(cls):
        cls._dossier = tempfile.mkdtemp(prefix='tests-medias-')
        cls._reglage = override_settings(MEDIA_ROOT=cls._dossier)
        cls._reglage.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._reglage.disable()
        shutil.rmtree(cls._dossier, ignore_errors=True)

    def enregistrer(self, objet):
        with self.captureOnCommitCallbacks(execute=True):
            objet.save()
        return objet

    def supprimer(self, objet):
        with self.captureOnCommitCallbacks(execute=True):
            objet.delete()

    def existe(self, nom):
        return default_storage.exists(nom)

    def largeur_fichier(self, nom):
        with default_storage.open(nom, 'rb') as f:
            with Image.open(f) as image:
                return image.format, image.width, image.height


# ======================================================================================
# Validation à l'upload
# ======================================================================================
class ValidationImageTests(TestCase):
    def erreurs(self, fichier):
        try:
            valider_image(fichier)
        except ValidationError as e:
            return ' '.join(e.messages)
        return ''

    def test_formats_acceptes(self):
        for format, nom in [('JPEG', 'a.jpg'), ('PNG', 'a.png'), ('WEBP', 'a.webp')]:
            with self.subTest(format=format):
                self.assertEqual(self.erreurs(creer_image(nom, format=format)), '')

    def test_format_refuse_d_apres_le_contenu_et_non_l_extension(self):
        self.assertIn('Format non accepté', self.erreurs(creer_image('a.jpg', format='GIF')))
        self.assertIn('Format non accepté', self.erreurs(creer_image('a.jpg', format='BMP')))

    def test_un_faux_fichier_image_est_refuse(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        faux = SimpleUploadedFile('virus.jpg', b'<?php echo 1; ?> ceci n\'est pas une image', content_type='image/jpeg')
        self.assertIn("n'est pas une image lisible", self.erreurs(faux))
        tronque = creer_image('a.png', format='PNG')
        tronque = type(tronque)('a.png', tronque.read()[:200], content_type='image/png')
        self.assertIn("n'est pas une image lisible", self.erreurs(tronque))

    def test_image_animee_refusee(self):
        from io import BytesIO

        from django.core.files.uploadedfile import SimpleUploadedFile
        premiere = Image.new('RGB', (800, 600), (255, 0, 0))
        suivante = Image.new('RGB', (800, 600), (0, 0, 255))
        tampon = BytesIO()
        premiere.save(tampon, 'WEBP', save_all=True, append_images=[suivante], duration=200)
        self.assertIn('animées', self.erreurs(SimpleUploadedFile('anim.webp', tampon.getvalue())))

    @override_settings(IMAGE_TAILLE_MAX_MO=1)
    def test_image_trop_lourde(self):
        message = self.erreurs(creer_image('lourde.png', 1200, 900, format='PNG', bruit=True))
        self.assertIn('trop lourde', message)
        self.assertIn('Maximum : 1 Mo', message)

    def test_image_trop_petite_message_clair(self):
        message = self.erreurs(creer_image('petite.jpg', 300, 200))
        self.assertIn('trop petite (300 × 200 pixels)', message)
        self.assertIn('Minimum : 600 × 400 pixels', message)

    @override_settings(IMAGE_LARGEUR_MIN=100, IMAGE_HAUTEUR_MIN=100)
    def test_les_dimensions_minimales_viennent_des_reglages(self):
        self.assertEqual(self.erreurs(creer_image('petite.jpg', 300, 200)), '')

    @override_settings(IMAGE_PIXELS_MAX=500_000)
    def test_image_gigantesque_refusee(self):
        self.assertIn('trop grande', self.erreurs(creer_image('enorme.jpg', 1200, 900)))

    def test_une_image_deja_enregistree_n_est_pas_recontrolee(self):
        class Enregistre:
            _committed = True
        self.assertEqual(self.erreurs(Enregistre()), '')


# ======================================================================================
# Texte alternatif obligatoire
# ======================================================================================
class AltObligatoireTests(StockageTemporaire):
    def test_evenement_lieu_et_categorie_exigent_un_alt_des_qu_il_y_a_une_image(self):
        organisation = creer_organisation()
        cas = [
            (Evenement(organisation=organisation, titre='X', debut='2030-01-01T20:00Z', image_principale=creer_image()), 'image_principale_alt'),
            (Lieu(nom='Salle', ville='Ville', photo_principale=creer_image()), 'photo_principale_alt'),
            (Categorie(nom='Cat', illustration=creer_image()), 'illustration_alt'),
        ]
        for objet, champ_alt in cas:
            with self.subTest(modele=type(objet).__name__):
                with self.assertRaises(ValidationError) as contexte:
                    objet.full_clean(exclude=['organisation', 'slug'])
                self.assertIn(champ_alt, contexte.exception.message_dict)
                setattr(objet, champ_alt, 'Une description')
                objet.full_clean(exclude=['organisation', 'slug'])      # plus d'erreur

    def test_pas_d_image_pas_d_alt_requis(self):
        Categorie(nom='Sans image').full_clean(exclude=['slug'])

    def test_les_images_de_galerie_exigent_un_alt(self):
        evenement, _ = creer_evenement()
        galerie = ImageEvenement(evenement=evenement, image=creer_image(), alt='')
        with self.assertRaises(ValidationError) as contexte:
            galerie.full_clean()
        self.assertIn('alt', contexte.exception.message_dict)
        lieu = Lieu.objects.create(nom='Salle', ville='Ville')
        with self.assertRaises(ValidationError):
            ImageLieu(lieu=lieu, image=creer_image(), alt='  ').full_clean()


# ======================================================================================
# Versions WebP
# ======================================================================================
class VersionsWebpTests(StockageTemporaire):
    def evenement_avec_image(self, **image):
        evenement, _ = creer_evenement()
        evenement.image_principale = creer_image(**image)
        evenement.image_principale_alt = 'Description'
        return self.enregistrer(evenement)

    def test_trois_versions_webp_conservees_a_cote_de_l_original(self):
        evenement = self.evenement_avec_image(largeur=2000, hauteur=1200)
        nom = evenement.image_principale.name
        self.assertTrue(self.existe(nom))                                   # l'original est conservé
        for largeur, hauteur in [(320, 192), (800, 480), (1600, 960)]:
            format, l, h = self.largeur_fichier(images.nom_version(nom, largeur))
            self.assertEqual((format, l, h), ('WEBP', largeur, hauteur))    # WebP, bonne largeur, proportions gardées

    def test_jamais_agrandie(self):
        evenement = self.evenement_avec_image(largeur=1000, hauteur=700)
        nom = evenement.image_principale.name
        self.assertEqual(self.largeur_fichier(images.nom_version(nom, 1000))[1], 1000)   # la « grande » = l'original en WebP
        self.assertFalse(self.existe(images.nom_version(nom, 1600)))
        self.assertFalse(self.existe(images.nom_version(nom, 1200)))

    def test_les_dimensions_sont_enregistrees(self):
        evenement = self.evenement_avec_image(largeur=1500, hauteur=1000)
        evenement.refresh_from_db()
        self.assertEqual((evenement.image_principale_largeur, evenement.image_principale_hauteur), (1500, 1000))

    def test_photo_de_telephone_redressee_et_dimensions_coherentes(self):
        """Orientation EXIF 6 : la photo est « couchée » dans le fichier mais s'affiche debout."""
        evenement = self.evenement_avec_image(largeur=1200, hauteur=800, orientation_exif=6)
        evenement.refresh_from_db()
        self.assertEqual((evenement.image_principale_largeur, evenement.image_principale_hauteur), (800, 1200))
        nom = evenement.image_principale.name
        self.assertEqual(self.largeur_fichier(images.nom_version(nom, 320))[1:], (320, 480))
        self.assertTrue(self.existe(images.nom_version(nom, 800)))
        self.assertFalse(self.existe(images.nom_version(nom, 1200)))        # le srcset n'annoncera que des fichiers qui existent

    def test_les_versions_ne_gardent_pas_les_metadonnees(self):
        evenement = self.evenement_avec_image(largeur=1200, hauteur=800, orientation_exif=1)
        with default_storage.open(images.nom_version(evenement.image_principale.name, 800), 'rb') as f:
            self.assertFalse(Image.open(f).getexif())

    def test_images_enregistrees_par_du_code_sont_aussi_traitees(self):
        """`champ.save(nom, contenu)` valide le fichier tout de suite : il doit être traité comme un envoi par formulaire."""
        from django.core.files.base import ContentFile
        evenement, _ = creer_evenement()
        evenement.image_principale.save('par-code.jpg', ContentFile(creer_image(largeur=2000, hauteur=1200).read()), save=False)
        evenement.image_principale_alt = 'Importée'
        self.enregistrer(evenement)
        nom = evenement.image_principale.name
        self.assertTrue(self.existe(images.nom_version(nom, 320)) and self.existe(images.nom_version(nom, 800)))
        evenement.refresh_from_db()
        self.assertEqual(evenement.image_principale_largeur, 2000)

    def test_une_image_deja_enregistree_n_est_pas_retraitee(self):
        evenement = self.evenement_avec_image(largeur=1200, hauteur=800)
        nom_version = images.nom_version(evenement.image_principale.name, 320)
        with default_storage.open(nom_version, 'rb') as f:
            avant = f.read()
        evenement.titre = 'Nouveau titre'
        self.enregistrer(evenement)
        with default_storage.open(nom_version, 'rb') as f:
            self.assertEqual(f.read(), avant)

    @override_settings(IMAGE_LARGEURS={'miniature': 200, 'moyenne': 400, 'grande': 600})
    def test_les_largeurs_viennent_des_reglages(self):
        evenement = self.evenement_avec_image(largeur=1200, hauteur=800)
        nom = evenement.image_principale.name
        self.assertTrue(all(self.existe(images.nom_version(nom, l)) for l in (200, 400, 600)))
        self.assertFalse(self.existe(images.nom_version(nom, 320)))

    def test_toutes_les_images_de_galerie_sont_traitees(self):
        evenement, _ = creer_evenement()
        photo = self.enregistrer(ImageEvenement(evenement=evenement, image=creer_image('g.png', format='PNG'), alt='Galerie'))
        self.assertTrue(self.existe(images.nom_version(photo.image.name, 320)))
        lieu = Lieu.objects.create(nom='Salle', ville='Ville')
        photo_lieu = self.enregistrer(ImageLieu(lieu=lieu, image=creer_image('l.jpg'), alt='Le lieu'))
        self.assertTrue(self.existe(images.nom_version(photo_lieu.image.name, 800)))


# ======================================================================================
# Suppression des fichiers
# ======================================================================================
class SuppressionFichiersTests(StockageTemporaire):
    def fichiers_de(self, image):
        nom = image.name
        return [nom] + [images.nom_version(nom, l) for l in (320, 800, 1600)]

    def evenement_avec_image(self):
        evenement, _ = creer_evenement()
        evenement.image_principale = creer_image(largeur=2000, hauteur=1200)
        evenement.image_principale_alt = 'Description'
        return self.enregistrer(evenement)

    def test_supprimer_l_evenement_supprime_l_original_et_les_versions(self):
        evenement = self.evenement_avec_image()
        fichiers = self.fichiers_de(evenement.image_principale)
        self.assertTrue(all(self.existe(f) for f in fichiers))
        evenement.commandes.all().delete()
        self.supprimer(evenement)
        self.assertFalse(any(self.existe(f) for f in fichiers))

    def test_remplacer_l_image_supprime_l_ancienne(self):
        evenement = self.evenement_avec_image()
        anciens = self.fichiers_de(evenement.image_principale)
        evenement.image_principale = creer_image('nouvelle.jpg', largeur=1400, hauteur=900)
        self.enregistrer(evenement)
        nouveaux = self.fichiers_de(evenement.image_principale)
        self.assertFalse(any(self.existe(f) for f in anciens))
        self.assertTrue(self.existe(nouveaux[0]) and self.existe(nouveaux[1]))

    def test_retirer_l_image_supprime_les_fichiers(self):
        evenement = self.evenement_avec_image()
        fichiers = self.fichiers_de(evenement.image_principale)
        evenement.image_principale = ''
        evenement.image_principale_alt = ''
        self.enregistrer(evenement)
        self.assertFalse(any(self.existe(f) for f in fichiers))

    def test_supprimer_une_image_de_galerie_supprime_ses_fichiers(self):
        evenement, _ = creer_evenement()
        photo = self.enregistrer(ImageEvenement(evenement=evenement, image=creer_image(largeur=2000, hauteur=1200), alt='G'))
        fichiers = self.fichiers_de(photo.image)
        self.supprimer(photo)
        self.assertFalse(any(self.existe(f) for f in fichiers))

    def test_supprimer_un_evenement_supprime_aussi_sa_galerie(self):
        evenement, _ = creer_evenement()
        photo = self.enregistrer(ImageEvenement(evenement=evenement, image=creer_image(largeur=2000, hauteur=1200), alt='G'))
        fichiers = self.fichiers_de(photo.image)
        self.supprimer(evenement)
        self.assertFalse(any(self.existe(f) for f in fichiers))

    def test_une_sauvegarde_annulee_ne_supprime_rien(self):
        """Si la transaction est annulée, l'ancienne image doit rester."""
        evenement = self.evenement_avec_image()
        anciens = self.fichiers_de(evenement.image_principale)
        evenement.image_principale = creer_image('autre.jpg', largeur=1400, hauteur=900)
        with self.captureOnCommitCallbacks(execute=False) as rappels:
            evenement.save()
        # aucun rappel exécuté (on simule l'annulation) : les anciens fichiers sont intacts
        self.assertTrue(all(self.existe(f) for f in anciens))
        self.assertTrue(len(rappels) >= 1)


# ======================================================================================
# Affichage public : srcset, lazy, solutions de repli
# ======================================================================================
class AffichageImagesTests(StockageTemporaire):
    def evenement(self, **champs):
        evenement, _ = creer_evenement(a_la_une=True, **champs)
        return evenement

    def avec_image(self, evenement):
        evenement.image_principale = creer_image(largeur=2000, hauteur=1200)
        evenement.image_principale_alt = 'Foule devant la scène'
        return self.enregistrer(evenement)

    def test_carte_avec_srcset_sizes_lazy_et_alt(self):
        self.avec_image(self.evenement())
        page = self.client.get(reverse('accueil')).content.decode()
        self.assertIn('srcset="', page)
        self.assertRegex(page, r'-320w\.webp \d+w|-320w\.webp 320w')
        self.assertIn('320w', page)
        self.assertIn('1600w', page)
        self.assertIn('sizes="(min-width: 1024px) 340px, 80vw"', page)
        self.assertIn('loading="lazy"', page)
        self.assertIn('alt="Foule devant la scène"', page)
        self.assertIn('width="2000"', page)
        self.assertIn('height="1200"', page)

    def test_fiche_image_principale_en_priorite_et_galerie_en_lazy(self):
        evenement = self.avec_image(self.evenement())
        self.enregistrer(ImageEvenement(evenement=evenement, image=creer_image('g.jpg', 1000, 700), alt='Vue de la salle'))
        page = self.client.get(reverse('evenement_detail', args=[evenement.slug])).content.decode()
        principale = page[page.index('class="fiche-image"') - 400:page.index('class="fiche-image"') + 200]
        self.assertIn('fetchpriority="high"', principale)
        self.assertNotIn('loading="lazy"', principale)                       # image visible dès l'arrivée : pas de chargement différé
        galerie = page[page.index('fiche-galerie'):]
        self.assertIn('loading="lazy"', galerie)
        self.assertIn('alt="Vue de la salle"', galerie)

    def test_galerie_absente_si_aucune_image(self):
        evenement = self.evenement()
        self.assertNotContains(self.client.get(reverse('evenement_detail', args=[evenement.slug])), 'fiche-galerie')

    def test_ordre_de_la_galerie_respecte(self):
        evenement = self.evenement()
        for nom, ordre in [('Troisième', 2), ('Première', 0), ('Deuxième', 1)]:
            self.enregistrer(ImageEvenement(evenement=evenement, image=creer_image(nom + '.jpg', 800, 600), alt=nom, ordre=ordre))
        page = self.client.get(reverse('evenement_detail', args=[evenement.slug])).content.decode()
        self.assertLess(page.index('alt="Première"'), page.index('alt="Deuxième"'))
        self.assertLess(page.index('alt="Deuxième"'), page.index('alt="Troisième"'))

    def test_repli_sur_l_illustration_de_la_categorie(self):
        categorie = Categorie.objects.create(nom='Jazz', illustration=creer_image('cat.jpg', 900, 600), illustration_alt='Un saxophone')
        categorie = self.enregistrer(categorie)
        self.evenement(categorie=categorie)
        page = self.client.get(reverse('accueil')).content.decode()
        self.assertIn('alt="Un saxophone"', page)
        self.assertNotIn('ticket-fallback', page)

    def test_repli_final_bloc_de_couleur_sans_aucune_image(self):
        categorie = Categorie.objects.create(nom='Sans image', couleur='#123456')
        self.evenement(categorie=categorie)
        page = self.client.get(reverse('accueil')).content.decode()
        self.assertIn('ticket-fallback', page)
        self.assertIn('--fond:#123456', page)
        self.assertNotIn('<img', page.split('class="ticket-media"')[1].split('ticket-body')[0])   # aucune image inventée

    def test_l_image_de_l_evenement_prime_sur_celle_de_la_categorie(self):
        categorie = self.enregistrer(Categorie(nom='Jazz', illustration=creer_image('cat.jpg', 900, 600), illustration_alt='Illustration catégorie'))
        self.avec_image(self.evenement(categorie=categorie))
        page = self.client.get(reverse('accueil')).content.decode()
        self.assertIn('alt="Foule devant la scène"', page)
        self.assertNotIn('Illustration catégorie', page)


# ======================================================================================
# Admin
# ======================================================================================
@HACHAGE_RAPIDE
class AdminImagesTests(StockageTemporaire):
    def setUp(self):
        self.client.force_login(get_user_model().objects.create_superuser(username='chef', email='chef@test.fr', password='x' * 12))

    def test_categorie_image_sans_alt_refusee_puis_acceptee(self):
        url = reverse('admin:ticketing_categorie_add')
        r = self.client.post(url, {'nom': 'Théâtre', 'slug': 'theatre', 'ordre': 0, 'actif': 'on', 'illustration': creer_image(), 'illustration_alt': ''})
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, 'le texte alternatif est obligatoire')
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(url, {'nom': 'Théâtre', 'slug': 'theatre', 'ordre': 0, 'actif': 'on',
                                       'illustration': creer_image(), 'illustration_alt': 'Un rideau rouge'})
        self.assertEqual(r.status_code, 302)
        categorie = Categorie.objects.get(slug='theatre')
        self.assertTrue(self.existe(images.nom_version(categorie.illustration.name, 320)))

    def test_categorie_image_invalide_message_clair(self):
        r = self.client.post(reverse('admin:ticketing_categorie_add'), {
            'nom': 'X', 'slug': 'x', 'ordre': 0, 'illustration': creer_image(largeur=200, hauteur=100), 'illustration_alt': 'Texte'})
        self.assertContains(r, 'trop petite')

    def test_evenement_avec_image_et_galerie_dans_la_meme_fiche(self):
        organisation = creer_organisation()
        donnees = {
            'organisation': organisation.pk, 'titre': 'Saisi en admin', 'slug': 'saisi-en-admin', 'debut_0': '2030-01-01', 'debut_1': '20:00:00',
            'fuseau_horaire': 'Europe/Paris', 'publie': 'on',
            'image_principale': creer_image(), 'image_principale_alt': 'Affiche',
            'types_place-TOTAL_FORMS': '0', 'types_place-INITIAL_FORMS': '0', 'types_place-MIN_NUM_FORMS': '0', 'types_place-MAX_NUM_FORMS': '1000',
            'galerie-TOTAL_FORMS': '1', 'galerie-INITIAL_FORMS': '0', 'galerie-MIN_NUM_FORMS': '0', 'galerie-MAX_NUM_FORMS': '1000',
            'galerie-0-image': creer_image('galerie.png', format='PNG'), 'galerie-0-alt': 'Vue de la salle', 'galerie-0-ordre': '0',
        }
        with self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(reverse('admin:ticketing_evenement_add'), donnees)
        self.assertEqual(r.status_code, 302, getattr(r, 'context', None) and r.context['adminform'].form.errors)
        evenement = Evenement.objects.get(slug='saisi-en-admin')
        self.assertEqual(evenement.galerie.count(), 1)
        self.assertTrue(self.existe(images.nom_version(evenement.galerie.get().image.name, 800)))

    def test_galerie_sans_alt_refusee_dans_la_fiche(self):
        organisation = creer_organisation()
        r = self.client.post(reverse('admin:ticketing_evenement_add'), {
            'organisation': organisation.pk, 'titre': 'X', 'slug': 'x', 'debut_0': '2030-01-01', 'debut_1': '20:00:00', 'fuseau_horaire': 'Europe/Paris',
            'types_place-TOTAL_FORMS': '0', 'types_place-INITIAL_FORMS': '0', 'types_place-MIN_NUM_FORMS': '0', 'types_place-MAX_NUM_FORMS': '1000',
            'galerie-TOTAL_FORMS': '1', 'galerie-INITIAL_FORMS': '0', 'galerie-MIN_NUM_FORMS': '0', 'galerie-MAX_NUM_FORMS': '1000',
            'galerie-0-image': creer_image(), 'galerie-0-alt': '', 'galerie-0-ordre': '0'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Evenement.objects.count(), 0)

    def test_fiches_de_lieu_et_de_categorie_s_affichent(self):
        lieu = Lieu.objects.create(nom='Salle', ville='Ville')
        self.assertEqual(self.client.get(reverse('admin:ticketing_lieu_change', args=[lieu.pk])).status_code, 200)
        self.assertEqual(self.client.get(reverse('admin:ticketing_lieu_add')).status_code, 200)


# ======================================================================================
# Espace organisateur : upload avec aperçu, galerie, ordre
# ======================================================================================
@HACHAGE_RAPIDE
class ImagesOrganisateurTests(StockageTemporaire):
    def setUp(self):
        self.orga_a, self.orga_b = creer_organisation('Collectif A'), creer_organisation('Collectif B')
        self.ev_a, _ = creer_evenement(self.orga_a, titre='Événement A')
        self.ev_b, _ = creer_evenement(self.orga_b, titre='Événement B')
        self.admin_a = creer_utilisateur('admin-a@test.fr')
        self.gest_a = creer_utilisateur('gest-a@test.fr')
        self.ctrl_a = creer_utilisateur('ctrl-a@test.fr')
        self.admin_b = creer_utilisateur('admin-b@test.fr')
        Membre.objects.create(utilisateur=self.admin_a, organisation=self.orga_a, role=Membre.ADMIN)
        Membre.objects.create(utilisateur=self.gest_a, organisation=self.orga_a, role=Membre.GESTIONNAIRE)
        Membre.objects.create(utilisateur=self.ctrl_a, organisation=self.orga_a, role=Membre.CONTROLEUR)
        Membre.objects.create(utilisateur=self.admin_b, organisation=self.orga_b, role=Membre.ADMIN)
        self.url = reverse('orga_images', args=[self.orga_a.slug, self.ev_a.pk])

    def poster(self, donnees, url=None):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(url or self.url, donnees)

    def ajouter(self, **champs):
        donnees = {'action': 'ajouter', 'ajout-image': creer_image(), 'ajout-alt': 'Une description', **champs}
        return self.poster(donnees)

    # -- accès
    def test_acces_selon_le_role_et_l_organisation(self):
        self.assertEqual(self.client.get(self.url).status_code, 404)                 # anonyme
        for utilisateur, attendu in [(self.admin_a, 200), (self.gest_a, 200), (self.ctrl_a, 404), (self.admin_b, 404)]:
            with self.subTest(utilisateur=utilisateur.email):
                self.client.force_login(utilisateur)
                self.assertEqual(self.client.get(self.url).status_code, attendu)

    def test_impossible_de_toucher_aux_images_d_un_autre_evenement(self):
        self.client.force_login(self.admin_a)
        url_b = reverse('orga_images', args=[self.orga_a.slug, self.ev_b.pk])        # événement de B via l'organisation A
        self.assertEqual(self.client.get(url_b).status_code, 404)
        self.assertEqual(self.poster({'action': 'ajouter', 'ajout-image': creer_image(), 'ajout-alt': 'X'}, url_b).status_code, 404)
        self.assertEqual(ImageEvenement.objects.count(), 0)

    def test_page_avec_apercu_et_limites_des_reglages(self):
        self.client.force_login(self.admin_a)
        page = self.client.get(self.url).content.decode()
        self.assertIn('data-apercu', page)
        self.assertIn('js/orga.js', page)
        self.assertIn('data-max-octets="5242880"', page)
        self.assertIn('5 Mo maximum', page)
        self.assertIn('600 × 400', page)
        self.assertIn('accept="image/jpeg,image/png,image/webp"', page)

    # -- image principale
    def test_envoi_de_l_image_principale(self):
        self.client.force_login(self.admin_a)
        r = self.poster({'action': 'principale', 'principale-image_principale': creer_image(largeur=2000, hauteur=1200),
                         'principale-image_principale_alt': 'Affiche du concert'})
        self.assertEqual(r.status_code, 302)
        self.ev_a.refresh_from_db()
        self.assertEqual(self.ev_a.image_principale_alt, 'Affiche du concert')
        self.assertTrue(self.existe(images.nom_version(self.ev_a.image_principale.name, 800)))
        self.assertContains(self.client.get(r['Location']), 'Image principale enregistrée.')

    def test_image_principale_refusee_sans_alt_ou_trop_petite(self):
        self.client.force_login(self.admin_a)
        r = self.poster({'action': 'principale', 'principale-image_principale': creer_image(), 'principale-image_principale_alt': ''})
        self.assertContains(r, 'le texte alternatif est obligatoire')
        r = self.poster({'action': 'principale', 'principale-image_principale': creer_image(largeur=200, hauteur=100),
                         'principale-image_principale_alt': 'Texte'})
        self.assertContains(r, 'trop petite')
        self.ev_a.refresh_from_db()
        self.assertFalse(self.ev_a.image_principale)

    def test_suppression_de_l_image_principale(self):
        self.client.force_login(self.admin_a)
        self.poster({'action': 'principale', 'principale-image_principale': creer_image(), 'principale-image_principale_alt': 'A'})
        self.ev_a.refresh_from_db()
        nom = self.ev_a.image_principale.name
        r = self.poster({'action': 'principale', 'principale-supprimer': 'on', 'principale-image_principale_alt': 'A'})
        self.assertEqual(r.status_code, 302)
        self.ev_a.refresh_from_db()
        self.assertFalse(self.ev_a.image_principale)
        self.assertEqual(self.ev_a.image_principale_alt, '')
        self.assertFalse(self.existe(nom))

    # -- galerie
    def test_ajout_a_la_galerie_avec_ordre_croissant(self):
        self.client.force_login(self.admin_a)
        self.assertEqual(self.ajouter(**{'ajout-alt': 'Première'}).status_code, 302)
        self.ajouter(**{'ajout-alt': 'Seconde'})
        self.assertEqual(list(self.ev_a.galerie.values_list('alt', flat=True)), ['Première', 'Seconde'])

    def test_ajout_refuse_sans_alt_ou_format_invalide(self):
        self.client.force_login(self.admin_a)
        self.assertContains(self.ajouter(**{'ajout-alt': ''}), 'obligatoire')
        self.assertContains(self.ajouter(**{'ajout-image': creer_image('a.gif', format='GIF')}), 'Format non accepté')
        self.assertEqual(self.ev_a.galerie.count(), 0)

    def formset(self, images_galerie, **changements):
        donnees = {'action': 'galerie', 'galerie-TOTAL_FORMS': str(len(images_galerie)), 'galerie-INITIAL_FORMS': str(len(images_galerie)),
                   'galerie-MIN_NUM_FORMS': '0', 'galerie-MAX_NUM_FORMS': '1000'}
        for i, image in enumerate(images_galerie):
            donnees.update({f'galerie-{i}-id': image.pk, f'galerie-{i}-alt': image.alt, f'galerie-{i}-ordre': image.ordre})
        donnees.update(changements)
        return donnees

    def galerie_de_trois(self):
        for nom in ['A', 'B', 'C']:
            self.enregistrer(ImageEvenement(evenement=self.ev_a, image=creer_image(nom + '.jpg'), alt=nom, ordre=len(nom) and 'ABC'.index(nom)))
        return list(self.ev_a.galerie.all())

    def test_reordonnancement_de_la_galerie(self):
        self.client.force_login(self.admin_a)
        a, b, c = self.galerie_de_trois()
        # le JavaScript renumérote : C en premier, puis A, puis B
        r = self.poster(self.formset([a, b, c], **{'galerie-0-ordre': 1, 'galerie-1-ordre': 2, 'galerie-2-ordre': 0}))
        self.assertEqual(r.status_code, 302)
        self.assertEqual(list(self.ev_a.galerie.values_list('alt', flat=True)), ['C', 'A', 'B'])
        self.assertEqual(list(self.ev_a.galerie.values_list('ordre', flat=True)), [0, 1, 2])   # renumérotation propre

    def test_modification_du_texte_et_suppression_dans_la_galerie(self):
        self.client.force_login(self.admin_a)
        a, b, c = self.galerie_de_trois()
        nom_b = b.image.name
        r = self.poster(self.formset([a, b, c], **{'galerie-0-alt': 'Nouveau texte', 'galerie-1-DELETE': 'on'}))
        self.assertEqual(r.status_code, 302)
        self.assertEqual(sorted(self.ev_a.galerie.values_list('alt', flat=True)), ['C', 'Nouveau texte'])
        self.assertFalse(self.existe(nom_b))                                          # fichiers supprimés avec l'image

    def test_galerie_alt_vide_refuse(self):
        self.client.force_login(self.admin_a)
        a, b, c = self.galerie_de_trois()
        r = self.poster(self.formset([a, b, c], **{'galerie-0-alt': ''}))
        self.assertEqual(r.status_code, 200)
        a.refresh_from_db()
        self.assertEqual(a.alt, 'A')

    def test_une_image_d_un_autre_collectif_n_est_pas_modifiable_via_le_formulaire(self):
        autre = self.enregistrer(ImageEvenement(evenement=self.ev_b, image=creer_image('b.jpg'), alt='Image de B'))
        self.client.force_login(self.admin_a)
        donnees = {'action': 'galerie', 'galerie-TOTAL_FORMS': '1', 'galerie-INITIAL_FORMS': '1', 'galerie-MIN_NUM_FORMS': '0',
                   'galerie-MAX_NUM_FORMS': '1000', 'galerie-0-id': autre.pk, 'galerie-0-alt': 'Piratée', 'galerie-0-ordre': 0,
                   'galerie-0-DELETE': 'on'}
        self.poster(donnees)
        autre.refresh_from_db()
        self.assertEqual(autre.alt, 'Image de B')
        self.assertTrue(ImageEvenement.objects.filter(pk=autre.pk).exists())
        self.assertTrue(self.existe(autre.image.name))

    def test_action_inconnue_donne_404(self):
        self.client.force_login(self.admin_a)
        self.assertEqual(self.poster({'action': 'nimporte'}).status_code, 404)

    def test_csrf_exige_en_conditions_reelles(self):
        from django.test import Client
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.admin_a)
        self.assertEqual(client.post(self.url, {'action': 'ajouter'}).status_code, 403)
