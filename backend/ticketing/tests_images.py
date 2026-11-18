"""
Tests des images : validation à l'upload, alt obligatoire, versions WebP, suppression des fichiers, affichage
(srcset, lazy, solutions de repli) et gestion dans l'espace organisateur. Chaque test crée ses données, dans
un dossier temporaire qui est effacé à la fin (jamais le vrai dossier des médias).
"""
import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from . import images
from .fabriques import creer_evenement, creer_image, creer_organisation
from .images import valider_image
from .models import Categorie, Evenement, ImageEvenement, ImageLieu, Lieu

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
            'fuseau_horaire': 'Europe/Paris', 'devise': 'EUR', 'publie': 'on',
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
            'devise': 'EUR',
            'types_place-TOTAL_FORMS': '0', 'types_place-INITIAL_FORMS': '0', 'types_place-MIN_NUM_FORMS': '0', 'types_place-MAX_NUM_FORMS': '1000',
            'galerie-TOTAL_FORMS': '1', 'galerie-INITIAL_FORMS': '0', 'galerie-MIN_NUM_FORMS': '0', 'galerie-MAX_NUM_FORMS': '1000',
            'galerie-0-image': creer_image(), 'galerie-0-alt': '', 'galerie-0-ordre': '0'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Evenement.objects.count(), 0)
        self.assertFalse(r.context['adminform'].form.errors)   # la fiche elle-même est valide : seul le texte alternatif de la galerie manque
        self.assertTrue(any(formulaire.errors for formset in r.context['inline_admin_formsets'] for formulaire in formset.formset.forms))

    def test_fiches_de_lieu_et_de_categorie_s_affichent(self):
        lieu = Lieu.objects.create(nom='Salle', ville='Ville')
        self.assertEqual(self.client.get(reverse('admin:ticketing_lieu_change', args=[lieu.pk])).status_code, 200)
        self.assertEqual(self.client.get(reverse('admin:ticketing_lieu_add')).status_code, 200)
