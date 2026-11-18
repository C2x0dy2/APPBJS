# Fosse : billetterie (application React / Expo + Supabase)

Application de billetterie pour un collectif de Bordeaux (et deux collectifs partenaires), pour iOS, Android et le
web. Un seul code, en TypeScript, avec [Expo](https://expo.dev) (SDK 57) et Expo Router. Deux espaces :

- **Acheteur** (compte obligatoire) : accueil et recherche, détail d'un événement, réservation (plusieurs types de
  billets à la fois), mes billets (QR code), mes réservations en attente, annulation jusqu'à la date limite.
- **Organisateur** (cloisonné par collectif) : ses événements, création et modification, annulation (avec
  remboursement automatique des commandes payées par carte), tableau de bord des ventes en temps réel, scan des
  billets à l'entrée, export CSV des participants.

Ce dépôt contient **l'application ET le backend** : `src/` (Expo/React Native) et `supabase/` (schéma, moteur de
réservation, fonctions Edge) vivent au même endroit — voir aussi `supabase/README.md` pour la mise en place du
projet Supabase.

## Lancer l'application

```bash
npm install
cp .env.example .env     # renseigner EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start            # « w » pour le web ; ou Expo Go / un émulateur
```

Avant de livrer : `npx tsc --noEmit` et `npx expo lint`.

## Où est quoi

| Dossier | Rôle |
| --- | --- |
| `src/app/` | Les écrans (une route par fichier, Expo Router) : `(buyer)/`, `organizer/`, connexion, inscription, liens reçus par e-mail, pages légales |
| `src/services/` | **Le seul endroit qui parle à Supabase** (`lib/supabase.ts` : le client ; `services/api.ts` : erreurs communes). Les écrans passent toujours par là, jamais par un accès direct à `supabase.from()` depuis un composant |
| `src/types/` | La forme exacte de chaque objet renvoyé par les services |
| `src/context/` | Qui est connecté (`auth`), réglages du site (`site`) |
| `src/hooks/use-load.ts` | Lecture de données avec chargement, erreur et « Réessayer » |
| `src/components/` | Composants (`ui/` : le kit : boutons, champs, cartes…) |
| `supabase/migrations/` | Le schéma et toute la logique métier critique (anti-survente, idempotence des paiements, liste d'attente, scan, annulation d'événement) en fonctions SQL atomiques |
| `supabase/functions/` | Fonctions Edge (Deno) : paiement Stripe, email de confirmation, connexion par nom d'utilisateur, annulation d'événement avec remboursement |

La session est gérée par Supabase Auth (jeton gardé par le client Supabase lui-même, via `expo-secure-store` sur
téléphone et `localStorage` sur le web).

## Le backend attendu

L'app ne parle qu'à Supabase : pas de serveur REST intermédiaire. `supabase/README.md` documente la mise en place
complète (migrations à exécuter dans l'ordre, secrets Stripe/Resend, planification `pg_cron`).

Codes d'erreur que l'application sait expliquer (voir `services/api.ts`) : `sold_out`, `not_authenticated`,
`not_authorized`, `event_not_on_sale`, `event_over`, `ticket_already_used`, `cancellation_deadline_passed`,
`order_not_cancellable`, `too_many_pending`, entre autres — un pour chaque exception levée côté SQL.
