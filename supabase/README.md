# Backend (Supabase)

## Mise en place (une fois)

1. Créer un projet sur [supabase.com](https://supabase.com) (gratuit pour démarrer).
2. Dans *Project Settings → API*, récupérer l'URL du projet et la clé `anon public`.
3. À la racine du repo : `cp .env.example .env`, puis coller l'URL et la clé dans `.env`.
4. Dans le *SQL Editor* du dashboard Supabase, exécuter les fichiers de `supabase/migrations/`
   **dans l'ordre numérique** (0001, 0002, 0003...).
5. Activer l'extension `pg_cron` (*Database → Extensions*), puis planifier le nettoyage des
   réservations expirées :

   ```sql
   select cron.schedule('expire-stale-reservations', '* * * * *', 'select expire_stale_reservations();');
   ```

## Mise en place de Stripe

1. Créer un compte sur [stripe.com](https://stripe.com) — le mode **Test** fonctionne sans
   vérification d'identité, parfait pour développer.
2. Dans le dashboard Stripe (mode Test) → *Developers → API keys*, récupérer la clé
   **Secret key** (`sk_test_...`).
3. Dans le dashboard Supabase → *Edge Functions* → *Manage secrets*, ajouter :
   - `STRIPE_SECRET_KEY` = la clé secrète Stripe
   - `SUPABASE_URL` = la même URL que dans `.env`
   - `SUPABASE_SERVICE_ROLE_KEY` = la clé **secrète** Supabase (celle qu'on avait mise de côté,
     *Project Settings → API*) — jamais celle du téléphone
4. Toujours dans *Edge Functions*, créer une fonction par dossier dans `supabase/functions/` et
   coller le code de son `index.ts` :
   - `create-checkout-session`
   - `stripe-webhook`
   - `refund-order`
   - `cancel-order`
   - `cancel-event` (annulation d'un événement entier par l'organisateur)
5. Dans Stripe → *Developers → Webhooks → Add endpoint*, coller l'URL de la fonction
   `stripe-webhook` (donnée par Supabase après sa création), événement à écouter :
   `checkout.session.completed`. Stripe donne alors un **Signing secret** (`whsec_...`) —
   ajoutez-le dans Supabase comme secret `STRIPE_WEBHOOK_SECRET` (étape 3).

## Mise en place de l'email de confirmation (lot Mohammed)

1. Créer un compte sur [resend.com](https://resend.com) (gratuit pour démarrer) et récupérer
   une clé API (*API Keys*).
2. Dans Supabase → *Edge Functions* → *Manage secrets*, ajouter :
   - `RESEND_API_KEY` = la clé Resend
   - `TICKET_EMAIL_FROM` = l'adresse d'expédition (doit appartenir à un domaine vérifié dans
     Resend, sinon repli sur leur domaine de test)
   - `TICKET_LINK_BASE_URL` = l'URL de l'écran "Mes billets" de l'app (ou une page web
     équivalente) qui accepte `?token=<access_token>`
3. Créer la fonction `send-ticket-email` dans *Edge Functions* (coller `index.ts`) — elle n'a
   pas besoin d'être appelée depuis l'app, `stripe-webhook` le fait automatiquement après un
   paiement carte confirmé.
4. Un virement confirmé manuellement (`mark_order_paid_by_transfer`) ne déclenche pas encore cet
   envoi — seul le chemin carte le fait pour l'instant.

## Mise en place des comptes (2026-11-18 : bascule vers des comptes obligatoires)

Décision du 18/11 : acheteurs ET organisateurs doivent désormais se connecter (Supabase Auth),
au lieu du lien anonyme par `access_token`. La connexion se fait par **nom d'utilisateur**
(l'e-mail ne sert qu'à la vérification et au mot de passe oublié) :

1. Dans Supabase → *Authentication → Providers*, l'e-mail/mot de passe doit être activé (c'est
   le réglage par défaut).
2. Décider si la confirmation d'e-mail est obligatoire avant de pouvoir se connecter
   (*Authentication → Settings → Email confirmation*) — l'app gère les deux cas.
3. Créer la fonction `login-with-username` dans *Edge Functions* : elle résout le nom
   d'utilisateur en e-mail côté serveur (table `profiles`, migration `0015`) et vérifie le mot
   de passe — l'e-mail du compte ne quitte jamais ce serveur.
4. Secret nécessaire pour cette fonction : `SUPABASE_ANON_KEY` (en plus de `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` déjà réglés pour Stripe).

## Ce qui existe déjà

- **Schéma** (`0001_schema.sql`) : collectifs, événements, types de places, commandes,
  billets, journal d'idempotence des paiements, liste d'attente. Isolation multi-collectifs
  par Row Level Security — un collectif ne peut pas lire les données d'un autre, au niveau
  de la base, pas seulement dans l'écran.
- **Moteur de réservation** :
  - `reserve_seats(ticket_type_id, quantity, buyer_email, payment_method)` — attribue les
    places de façon atomique (verrou de ligne Postgres), ou échoue avec `sold_out`. Respecte
    aussi `transfer_cap` (plafond optionnel de places réservables par virement).
  - `confirm_payment(provider_event_id, order_id, payload)` — appelée par `stripe-webhook`.
    Idempotente (une notification reçue deux fois ne crée qu'un seul lot de billets), vérifie
    que le montant payé correspond à la commande, et gère le paiement arrivé après l'échéance
    (émet le billet si une place est encore libre, sinon signale qu'il faut rembourser).
  - `mark_order_paid_by_transfer(order_id)` — le bouton « Marquer comme payé » pour les
    virements, réservé aux organisateurs du collectif concerné.
  - `expire_stale_reservations()` — libère les réservations non payées arrivées à échéance et
    déclenche l'offre automatique à la liste d'attente ; à planifier via `pg_cron` (ci-dessus).
  - `offer_next_waitlist_entry(ticket_type_id)` / `join_waitlist(...)` — liste d'attente :
    inscription et offre automatique quand une place se libère (délai de réponse 12h, 2h si
    l'événement est dans moins de 48h).
  - `refund_order(order_id, amount_cents?)` — remboursement total ou partiel par un
    organisateur, appelée par la fonction `refund-order`.
  - `get_order_by_token(access_token)` / `get_tickets_by_order_token(access_token)` — permet à
    un acheteur sans compte de retrouver sa commande et ses billets via son lien personnel.
  - `cancel_order_by_token(access_token)` — annulation acheteur (`0013`) : libère la place vers
    la liste d'attente, calcule le remboursement si la commande était payée (sans jamais parler
    à Stripe elle-même — c'est l'Edge Function `cancel-order` qui le fait). Refuse après la
    date limite d'annulation de l'événement (`cancel_deadline_at`) ou si un billet a déjà été
    scanné.
  - `reserve_seats_multi(event_id, items, payment_method)` (`0014`) — comme `reserve_seats` mais
    pour PLUSIEURS types de place dans une seule commande, liée au compte connecté (`auth.uid()`).
    Tri fixe des types demandés pour éviter les blocages (deadlocks) entre commandes concurrentes.
  - `get_my_tickets()` / `get_my_pending_orders()` (`0014`) — l'équivalent connecté de
    `get_order_by_token`, pour l'acheteur avec compte.
  - `get_event_stats(event_id)` / `get_collective_summary(collective_id)` (`0014`) — tableau de
    bord organisateur : vendu/retenu/encaissé par type de place, remboursements, billets
    scannés, graphique de ventes sur 14 jours.
  - `validate_ticket_entry(event_id, code)` (`0016`) — scan à l'entrée : transition atomique
    valide → utilisé, même réponse pour un code inconnu/d'un autre événement (rien n'est révélé).
  - `cancel_event(event_id)` (`0016`) — annule un événement ENTIER (pas une commande) : libère
    les réservations en attente, invalide tous les billets, marque les commandes payées par carte
    à rembourser (`refund_pending`) et renvoie leur `payment_intent_id` pour que l'Edge Function
    `cancel-event` déclenche le remboursement Stripe.
  - `get_event_participants(event_id)` (`0016`) — liste pour l'export CSV, construit côté app.

- **Paiement Stripe** (`supabase/functions/`) :
  - `create-checkout-session` — crée la page de paiement Stripe pour une commande en attente.
  - `stripe-webhook` — reçoit la confirmation de Stripe, vérifie sa signature et le montant,
    puis appelle `confirm_payment`. Rembourse automatiquement si le paiement arrive trop tard
    et que la place a été reprise.
  - `refund-order` — remboursement déclenché par un organisateur (total ou partiel).
  - `cancel-order` — annulation déclenchée par l'acheteur lui-même via son `access_token` ;
    rembourse via Stripe si la commande était payée par carte.
  - `send-ticket-email` (lot Mohammed) — appelée par `stripe-webhook` juste après un paiement
    carte confirmé ; envoie un email avec le lien personnel vers l'écran "Mes billets" (le QR
    scannable est affiché dans l'app, pas intégré dans l'email). Un échec d'envoi ne fait jamais
    échouer le webhook Stripe.
  - `login-with-username` (`0015`) — résout le nom d'utilisateur en e-mail et connecte la
    personne ; ne renvoie que la session obtenue, jamais l'e-mail lui-même.
  - `cancel-event` (`0016`) — appelle `cancel_event()` avec le jeton de l'organisateur lui-même
    (pas la clé de service, pour que la vérification d'appartenance au collectif reste dans
    Postgres), puis rembourse via Stripe chaque commande payée par carte qu'elle a identifiée.

## Test de charge

`supabase/load-test.js` (k6) : simule N acheteurs qui cliquent "Réserver" en même temps sur un
type de billet à stock limité, et vérifie qu'il n'y a jamais plus de billets vendus que de
stock. Voir l'en-tête du fichier pour le mode d'emploi. Le principe anti-survente est déjà
prouvé par ce script à petite échelle (ex. 50 clients / 10 places) ; le relancer à l'échelle du
cahier des charges (500 / 100) avant la soutenance reste à faire — ça ne demande aucun
changement de code, juste de faire tourner le script avec des volumes plus grands contre le
projet Supabase réel.

## Pas encore fait

- **Affiche d'événement** : pas de bucket Supabase Storage ni de variantes d'image (srcset) —
  `uploadEventImage`/`removeEventImage` côté app renvoient une erreur claire plutôt qu'un faux
  succès.
- L'email de confirmation d'un virement (une fois marqué payé par un organisateur) n'est pas
  encore câblé, seul le paiement carte le fait.
- Remboursement automatique des virements lors d'une annulation d'événement : `refund_pending`
  est bien posé sur la commande, mais rien n'automatise l'envoi (un virement se rend à la main,
  comme pour un remboursement normal).
- Test de charge officiel à l'échelle du cahier des charges (script prêt, voir plus haut, pas
  encore exécuté contre le vrai projet).

## Côté app

Les événements et types de places se créent par de simples `insert`/`update` sur `events` et
`ticket_types` (RLS les autorise déjà pour les membres du collectif) — pas besoin de fonction
dédiée pour ça.
