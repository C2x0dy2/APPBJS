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

Il faut **Node.js 22 ou plus** : le web est rendu à l'avance par Node (`web.output: "static"`), et `supabase-js` y a
besoin du `WebSocket` intégré à Node 22 (avec Node 20, `npx expo export --platform web` échoue au rendu des pages).

Sans ces deux variables, l'application s'arrête au démarrage avec un message qui les nomme. Après chaque changement du
`.env` : `npx expo start --clear`.

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

## Ce que l'application utilise côté Supabase

- **Tables** : `events`, `ticket_types`, `collectives` (en jointure), `collective_members`, `profiles`, `legal_pages`, `site_settings`.
- **Fonctions SQL** (`supabase.rpc`) : `reserve_seats_multi`, `get_my_tickets`, `get_my_pending_orders`, `get_event_ticket_availability`,
  `get_event_stats`, `get_event_participants`, `get_collective_summary`, `validate_ticket_entry`, `create_profile`.
- **Edge Functions** : `login-with-username` (connexion par nom d'utilisateur), `cancel-event` (annulation d'un événement),
  `create-checkout-session` (ouvre le paiement Stripe d'une réservation par carte, bouton « Payer »).

### Réglage à faire dans le tableau de bord Supabase (liens reçus par e-mail)

Les e-mails de confirmation d'inscription et de mot de passe oublié ramènent sur l'app (`/verify-email`,
`/reset-password`, voir `src/services/auth-links.ts`). Supabase n'y renvoie que si ces adresses sont autorisées :
*Authentication → URL Configuration → Redirect URLs*, ajouter l'adresse du site web suivie de `/**`
(ex. `https://billetterie.exemple.fr/**`) et `billeterie://**` pour l'app sur téléphone (en développement avec
Expo Go : `exp://**`). Sans ce réglage, le lien ouvre la page d'accueil au lieu du bon écran.

Les migrations SQL et les Edge Functions sont **volontairement gardées hors de ce dépôt** (décision d'équipe du 18/11) :
elles vivent dans le dépôt séparé `APPBJS-Bintou`, pas ici. Ne pas les réimporter dans `front-divine` — ça a déjà été fait
et défait une fois. Leur dernière version versionnée dans *cet* historique reste consultable au commit `71191e8`
(`git show 71191e8 --stat -- supabase`) si besoin de retrouver une ancienne trace, sans la restaurer.

## Pas encore disponible

- L'envoi de l'affiche d'un événement : l'application affiche « pas encore disponible » au lieu de faire semblant.
- L'email de confirmation après paiement.

## Historique

Une première implémentation du serveur (Django, dossier `backend/`) existe dans l'historique git, au commit `ea6b31e`
(`git show ea6b31e --stat`, ou `git checkout ea6b31e -- backend`). Elle n'est plus dans le projet.
