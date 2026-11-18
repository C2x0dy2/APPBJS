# Fosse : billetterie (application React / Expo)

Application de billetterie pour un collectif de Bordeaux, pour iOS, Android et le web. Un seul code, en TypeScript, avec
[Expo](https://expo.dev) (SDK 57) et Expo Router. Deux espaces :

- **Acheteur** (ouvert aux visiteurs) : accueil et recherche, détail d'un événement, réservation, mes billets (QR code), tableau de bord, compte.
- **Organisateur** (cloisonné par collectif) : ses événements, création et modification, annulation, tableau de bord des ventes, contrôle des billets à l'entrée (caméra), export des participants.

Aucune donnée n'est écrite dans le code : tout vient d'un projet [Supabase](https://supabase.com) (base Postgres, comptes, fonctions).

## Lancer

```bash
npm install
cp .env.example .env     # puis renseigner l'adresse et la clé publique du projet Supabase
npx expo start           # « w » pour le web ; ou Expo Go / un émulateur
```

Sans ces deux variables, l'application s'arrête au démarrage avec un message qui les nomme. Les deux valeurs se trouvent dans
*Project Settings → API* du tableau de bord du projet Supabase de l'équipe (voir `supabase/README.md`) : demande-les à la
personne qui l'a créé. Après chaque changement du `.env` : `npx expo start --clear`.

Avant de livrer : `npx tsc --noEmit` et `npx expo lint --no-cache` (`expo lint` garde un cache : sans `--no-cache`, il peut
rejouer d'anciens résultats).

## Où est quoi

| Dossier | Rôle |
| --- | --- |
| `src/app/` | Les écrans (une route par fichier, Expo Router) : `(buyer)/`, `organizer/` (dont `event/scan/` : contrôle à l'entrée), connexion, inscription, liens reçus par e-mail, pages légales |
| `src/lib/supabase.ts` | Le client Supabase ; il garde la session de connexion sur l'appareil |
| `src/services/` | **Le seul endroit qui parle à Supabase** (`api.ts` : erreurs). Les écrans passent toujours par là |
| `src/types/` | La forme des données que les écrans utilisent |
| `src/context/` | Qui est connecté (`auth`), réglages du site (`site`) |
| `src/hooks/use-load.ts` | Lecture de données avec chargement, erreur et « Réessayer » |
| `src/components/` | Composants (`ui/` : le kit : boutons, champs, cartes…) |
| `supabase/` | Le serveur : migrations SQL, Edge Functions et test de charge (voir `supabase/README.md`) |

## Ce que l'application utilise côté Supabase

- **Tables** : `events`, `ticket_types`, `collectives` (en jointure), `collective_members`, `profiles`, `legal_pages`, `site_settings`.
- **Fonctions SQL** (`supabase.rpc`) : `reserve_seats_multi`, `get_my_tickets`, `get_my_pending_orders`, `get_event_ticket_availability`,
  `get_event_stats`, `get_event_participants`, `get_collective_summary`, `validate_ticket_entry`, `create_profile`.
- **Edge Functions** : `login-with-username` (connexion par nom d'utilisateur), `cancel-event` (annulation d'un événement).

Le serveur est versionné dans `supabase/` : `migrations/` (le schéma et la logique côté base : réservation sans survente,
paiement idempotent, liste d'attente, annulations et remboursements, comptes, chiffres de vente, contrôle à l'entrée),
`functions/` (les Edge Functions : paiement Stripe, e-mail de billet, connexion par nom d'utilisateur, annulations,
remboursement) et `load-test.js` (test de charge k6). **`supabase/README.md` explique comment mettre en place un projet
Supabase** : migrations à exécuter dans l'ordre, tâche planifiée, secrets Stripe et Resend.

## Pas encore disponible dans l'application

Le serveur sait déjà faire plus que ce que l'application appelle aujourd'hui. Pas encore branchés dans l'application :

- le paiement en ligne (Stripe : `create-checkout-session` et `stripe-webhook`) : pour l'instant une réservation bloque les
  places jusqu'à son échéance, puis elles sont rendues à la vente ;
- la liste d'attente (`join_waitlist`, avec offre automatique quand une place se libère) ;
- l'annulation par l'acheteur (`cancel-order`) et le remboursement par l'organisateur (`refund-order`) ;
- l'e-mail de billet (`send-ticket-email`, envoyé par le webhook après un paiement par carte).

Pas encore construit côté serveur : l'envoi de l'affiche d'un événement (l'application affiche « pas encore disponible » au
lieu de faire semblant).

## Historique

Une première implémentation du serveur (Django, dossier `backend/`) existe dans l'historique git, au commit `ea6b31e`
(`git show ea6b31e --stat`, ou `git checkout ea6b31e -- backend`). Elle n'est plus dans le projet.
