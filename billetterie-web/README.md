# Passage — outil de billetterie

Application en français construite à partir du « Cahier des charges — Outil de billetterie.docx ».

## Démarrer après avoir cloné le dépôt

Cette application web contient l’interface React et son API serveur. Le projet Expo présent à la racine du dépôt reste une application distincte. Les commandes ci-dessous concernent le dossier **billetterie-web**.

Installez **Node.js 22.13 ou supérieur**, puis ouvrez un terminal à la racine du dépôt `APPBJS` :

```powershell
cd billetterie-web
npm ci
npm run setup:local
npm run dev
```

Ouvrez **http://127.0.0.1:5173** et gardez le terminal ouvert. Pour arrêter le serveur, utilisez `Ctrl+C`.

`setup:local` crée `.env` à partir de `.env.example` si ce fichier n’existe pas, compile l’application et applique les migrations manquantes à la base locale. Vous pouvez relancer cette commande sans réinitialiser les données ni remplacer votre `.env`.

La configuration `.openai/hosting.json` fournie déclare le stockage local `DB` ; elle ne contient aucun identifiant de Site personnel. Les données locales restent dans `.wrangler/state`, indépendamment de celles d’une version en ligne. Les fichiers `.env` et la base locale ne sont pas envoyés dans Git.

La première ouverture crée trois collectifs et cinq événements d’exemple pour le printemps 2027. Le bandeau « Démonstration » reste visible. Les encaissements sont fictifs et aucun message n’est envoyé. Vous pouvez créer un événement, ouvrir sa page de vente, réserver, simuler le paiement, télécharger les billets, créer un lien scanneur et essayer les entrées.

## Fonctions développées

- Collectifs, invitations d’organisateurs et accès vérifiés côté serveur.
- Événements, lieux, fuseaux horaires, portes, échéances et statuts.
- Au moins deux types de places, stocks séparés, prix early temporaires et prix figé à la réservation.
- Panier de plusieurs types de places, limite par commande et compte à rebours.
- Réservations transactionnelles, expiration, reprise de stock pour les paiements tardifs et remboursement si le stock est épuisé.
- Paiements Stripe Checkout sur le compte Stripe Connect de chaque collectif ; signature des notifications, contrôle du montant et traitement idempotent.
- Un billet signé par place, QR, PDF et fichier agenda.
- Annulation par place, remboursement et annulation globale d’événement.
- Liste d’attente en ordre strict, offres avec réservation, relance automatique et fermeture à l’ouverture des portes.
- Contrôle par caméra et recherche manuelle ; accès limité à un événement et à sa journée locale.
- Préparation des billets sur le téléphone, vérification des signatures hors ligne, journal local des scans et synchronisation.
- Tableau de bord actualisé toutes les 15 secondes, stocks, commandes, remboursements, entrées, évolution et exports CSV/PDF.
- Journal des actions sensibles et file de traitements avec reprise après erreur.

En démonstration privée, l’utilisateur connecté peut changer de collectif pour tester les trois espaces. En service réel, le serveur limite chaque organisateur à ses appartenances ; seule l’adresse administrateur configurée accède à tous les collectifs.

## Avant les ventes réelles

L’application livrée est une **version de démonstration privée**, pas une billetterie déjà raccordée à des comptes bancaires. Aucun identifiant réel n’a été fourni.

1. Confirmer le choix de Stripe et Resend, ou adapter les connecteurs si un autre prestataire est retenu.
2. Configurer les secrets de production dans Sites : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, MAIL_FROM, ADMIN_EMAIL, APP_URL et JOB_SECRET. Ne jamais les ajouter au dépôt. Utiliser les clés de test Stripe pendant la recette.
3. Dans les réglages, associer chaque collectif à son compte Stripe Connect et inviter les organisateurs. Stripe doit être configuré pour notifier les événements des comptes connectés vers POST /api/webhook.
4. Créer les vrais événements et annuler les exemples. Les commandes fictives sont marquées demo=1 ; elles ne doivent pas être reprises dans la comptabilité réelle. Pour une exploitation réelle, utiliser une base de production propre, avec clés de signature et collectifs initialisés avant de désactiver la démonstration.
5. Configurer un appel serveur **chaque minute** à POST /api/maintenance, avec Authorization: Bearer JOB_SECRET. Le Worker fournit aussi un gestionnaire scheduled pour un hébergement acceptant les déclencheurs cron. Ce déclenchement autonome n’est pas configuré par la publication Sites : il doit être vérifié avant exploitation. Les échéances sont également contrôlées avant les réservations et sur les lectures des pages ; aucun achat concurrent ne peut dépasser le stock.
6. Passer DEMO_MODE=false, refaire les essais Stripe de paiement et de remboursement, puis ouvrir le site au public. La version actuelle reste privée. Les acheteurs utilisent leur lien personnel ; les organisateurs se connectent avec ChatGPT puis un code e-mail.
7. Vérifier sur les téléphones utilisés le contrôle caméra, le téléchargement complet de la page et des billets, le passage hors ligne, le rechargement et la synchronisation. Ces essais sur appareils physiques restent à faire.

Les e-mails et les remboursements sont enregistrés durablement avant leur traitement. Une erreur reste visible dans les réglages et sera réessayée. Une annulation invalide le billet immédiatement, même si le remboursement doit être réessayé.

Les frais du prestataire ne sont pas synchronisés dans cette version : le net affiché correspond aux encaissements moins remboursements, avant frais.

## Valeurs retenues

- Carte bancaire, réservation de 15 minutes, six places par commande.
- Billets non nominatifs ; le nom de l’acheteur sert à la recherche manuelle.
- Offres d’attente de 12 heures, réduites à 2 heures dans les 48 heures avant l’événement.
- Annulation intégrale d’une place jusqu’à l’échéance de l’événement, normalement 48 heures avant.
- Prix early terminé à une date et une heure, sur le stock commun du type de place.
- **Ordre strict de la liste d’attente** : une demande de deux places attend la disponibilité des deux, sans être dépassée par une demande d’une place.
- Le virement est une option du document ; il n’est pas activé ni implémenté dans cette première version carte seule.
- Le lien scanneur est valable le jour local de l’événement. En démonstration uniquement, il fonctionne immédiatement pendant sept jours.

## Limites du contrôle hors ligne

Deux téléphones hors ligne ne peuvent pas connaître les scans de l’autre. Utilisez un seul téléphone hors ligne ou une connexion commune. À la synchronisation, le premier enregistrement accepté par le serveur gagne et les conflits sont signalés.

Les annulations faites après le téléchargement ne sont visibles qu’au retour du réseau. La liste PDF des participants est disponible dans les exports de l’événement.

## Développement et vérifications

Exécutez ces commandes depuis **billetterie-web**. Node.js 22.13 ou supérieur est nécessaire ; Python est utilisé uniquement pour les tests SQLite.

```powershell
npm run check
npm run test:stock
npm run test:api
npm run test:load
npm run build
```

Les tests API nécessitent le serveur de développement en démonstration. Ils créent des événements et des commandes d’essai dans la base locale ; les événements d’essai sont annulés à la fin. Ne pas les exécuter sur une billetterie réelle.

Les migrations Drizzle sont dans drizzle/. La deuxième migration ajoute les garanties transactionnelles de stock, de paiement et de billets. Les fichiers SQL sont conservés en LF pour D1. Les migrations de production appliquées sont immuables.

Pour initialiser la base d’un nouveau clone ou appliquer les migrations ajoutées par l’équipe, arrêtez le serveur et exécutez :

```powershell
npm run setup:local
```

Les migrations déjà appliquées ne sont pas rejouées. `npm run db:generate` sert à produire une nouvelle migration après une modification du modèle ; il n’est pas nécessaire pour démarrer l’application.

## Architecture

React/Vinext, Cloudflare Worker et D1 (SQLite). Toutes les attributions, validations et permissions sont exécutées côté serveur. Les montants sont des entiers en centimes.

Le navigateur stocke seulement la préférence de navigation et les données explicitement nécessaires au contrôle hors ligne. Le stock, les paiements, les commandes et les autorisations restent dans D1.

Les QR sont signés en ECDSA P-256. Seule la clé publique est donnée aux scanneurs. Les codes de connexion sont hachés, limités à cinq essais et expirent au bout de dix minutes. Les liens personnels ont 256 bits aléatoires. Aucune donnée de carte bancaire ne traverse l’application.

La page expose deux outils WebMCP facultatifs : consulter les ventes et ouvrir le formulaire de création. La validation dans un navigateur compatible WebMCP n’était pas disponible dans cet environnement.

Documentation des connecteurs :
- [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create)
- [Notifications signées Stripe](https://docs.stripe.com/webhooks/signature)
- [Encaissement direct Stripe Connect](https://docs.stripe.com/connect/direct-charges)
- [Envoi d’e-mails Resend](https://resend.com/docs/api-reference/emails/send-email)
