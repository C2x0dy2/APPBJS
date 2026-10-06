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

## Liste d’attente

Le nombre de places demandé est limité à la plus petite valeur entre la capacité totale du type de place et le maximum par commande de l’événement. Si les places demandées sont disponibles et qu’aucune demande antérieure n’attend, l’inscription est refusée : l’acheteur doit réserver directement.

Plusieurs soumissions simultanées pour la même adresse e-mail et le même type de place créent une seule inscription active et une seule confirmation dans la file d’envoi. L’ordre strict reste appliqué : si le premier inscrit demande deux places et qu’une seule est libre, il attend la deuxième ; les demandes suivantes ne le dépassent pas.

Une offre libérée par l’acheteur ou arrivée à expiration cesse d’être active ; les places sont alors proposées à la demande suivante.

L’organisateur ne peut pas réduire la capacité d’un type de place sous la quantité demandée par une inscription active, en attente ou déjà proposée. Pour réduire davantage la capacité, il doit d’abord retirer les inscriptions concernées depuis le tableau de bord.

## Annulation acheteur et contrôle des entrées

L’annulation d’un billet par l’acheteur exige le lien personnel de sa commande, une échéance d’annulation encore ouverte et un billet jamais utilisé. Ces conditions sont vérifiées ensemble lors de la modification en base. L’échéance est comparée à l’heure SQL courante en millisecondes, même si la demande a attendu avant son traitement. [Fonctions de date SQLite](https://www.sqlite.org/lang_datefunc.html).

Si un scan et une annulation arrivent simultanément, la première modification acceptée détermine le résultat :

- Si le scan est enregistré en premier, le billet reste valide et marqué utilisé ; l’annulation acheteur est refusée, sans remboursement ni place libérée.
- Si l’annulation est enregistrée en premier, le QR est refusé côté serveur et une seule place est libérée vers la liste d’attente ou la vente. Le scan indique « billet annulé ».

Répéter une demande d’annulation ne déclenche aucun remboursement supplémentaire. Le contrôle distingue un billet annulé d’un billet déjà utilisé, dont il affiche l’heure du premier scan.

Un organisateur autorisé conserve la possibilité de rembourser un billet après son utilisation ou après l’échéance. Une demande acheteur ne peut pas obtenir ce droit en ajoutant un champ de contournement au formulaire ou à la requête.

## Limites du contrôle hors ligne

Avant le contrôle, le téléphone prépare la liste pendant que le lien scanneur est valide. Le serveur lui délivre une autorisation de synchronisation distincte, limitée à ce lien et à l’identifiant d’appareil déclaré ; seule son empreinte est conservée en base. Chaque billet est associé à son premier téléchargement. Une actualisation ajoute les nouveaux billets sans repousser les dates des anciens ni remplacer les droits des scans en attente.

Après l’expiration du lien, les nouveaux scans et téléchargements sont refusés. Les scans déjà enregistrés sur le téléphone peuvent être envoyés pendant **24 heures après cette expiration**, même après un rechargement de la page. Chaque scan garde son autorisation d’origine. Une panne de réseau conserve la file locale ; un refus du serveur est affiché comme conflit. Les anciennes files créées avant cette mise à jour, sans autorisation de synchronisation, restent visibles et nécessitent une vérification par l’organisateur.

Le serveur vérifie le QR signé, l’événement, la présence du billet dans la préparation, son statut actuel et l’heure déclarée : après son premier téléchargement, avant l’expiration du lien et sans date future. La suppression du lien ou une modification de sa période invalide aussi ses autorisations de synchronisation. La limite de réception est contrôlée sur les octets réellement reçus, sans dépendre de l’en-tête Content-Length.

L’heure hors ligne est déclarée par le téléphone : elle ne prouve pas cryptographiquement l’heure du passage physique. L’identifiant d’appareil ne constitue pas une attestation matérielle ; l’autorisation reste un secret à protéger. Au-delà du délai de synchronisation, l’application conserve les scans en attente pour permettre une vérification manuelle, sans les accepter automatiquement.

Deux téléphones hors ligne ne peuvent pas connaître les scans de l’autre. Utilisez un seul téléphone hors ligne ou une connexion commune. À la synchronisation, le premier enregistrement accepté par le serveur gagne et les conflits sont signalés.

Un scan hors ligne encore non synchronisé ne peut pas empêcher une annulation côté serveur. Les annulations faites après le téléchargement restent invisibles au téléphone jusqu’au retour du réseau ; la synchronisation applique alors le statut du serveur. La liste PDF des participants est disponible dans les exports de l’événement.

## Développement et vérifications

Exécutez ces commandes depuis **billetterie-web**. Node.js 22.13 ou supérieur est nécessaire ; Python est utilisé uniquement pour les tests SQLite.

```powershell
npm run check
npm run test:stock
npm run test:cancellation-race
npm run test:scanner-sync
npm run test:api
npm run test:waitlist
npm run test:cancellation
npm run test:load
npm run build
```

Les commandes `test:stock`, `test:cancellation-race` et `test:scanner-sync` utilisent des bases SQLite isolées et ne modifient pas la base locale de l’application. Le test de course charge les fonctions serveur réelles et contrôle les deux ordres possibles entre scan et annulation, avec SQLite en mémoire ; aucun serveur de développement n’est nécessaire. Le test de synchronisation charge aussi les routes API et vérifie les autorisations, les expirations, les révocations, les doublons, les dates et les limites de requête.

Les commandes `test:api`, `test:waitlist`, `test:cancellation` et `test:load` nécessitent le serveur de développement en démonstration, lancé dans un autre terminal. Elles créent des événements et des commandes d’essai dans la base locale ; les événements d’essai sont annulés à la fin. Ne pas les exécuter sur une billetterie réelle. `test:cancellation` vérifie les annulations par HTTP et refuse une cible hors de cet ordinateur ou une base hors démonstration.

`test:scanner-browser` utilise un Edge ou Chrome déjà installé, avec un profil temporaire isolé. Le chemin peut être fourni par `SCANNER_BROWSER_PATH`. Aucun navigateur n’est téléchargé. Pour tester les fichiers compilés et le service worker, démarrez la démonstration compilée dans un terminal :

```powershell
npm run build
npm run start -- --port 5181
```

Puis, dans un deuxième terminal placé dans `billetterie-web` :

```powershell
$env:TEST_URL='http://127.0.0.1:5181'
npm run test:scanner-browser
```

Ce test crée puis annule son événement d’essai. Il utilise réellement IndexedDB et le service worker, recharge la page sans réseau et simule une réponse perdue après l’enregistrement du scan par le serveur. Le nouvel envoi doit reconnaître la même entrée, vider la file locale et conserver le compteur à un. L’échéance est raccourcie côté navigateur pour éviter une attente d’une journée ; les expirations serveur réelles sont vérifiées séparément par `test:scanner-sync`. La caméra sur les téléphones physiques reste à tester.

Les migrations Drizzle sont dans drizzle/. La deuxième migration ajoute les garanties transactionnelles de stock, de paiement et de billets. La troisième ajoute les contrôles atomiques de liste d’attente, notamment lors de l’inscription et d’une réduction de capacité. La quatrième conserve les autorisations de synchronisation hors ligne ; elles sont supprimées par la maintenance après leur échéance. La préparation accepte jusqu’à 20 000 billets et 64 autorisations actives par lien ; les actualisations réutilisent celle du téléphone. Les fichiers SQL sont conservés en LF pour D1. Les migrations de production appliquées sont immuables.

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
