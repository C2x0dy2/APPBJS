# Fosse : billetterie (application React / Expo)

Application de billetterie pour un collectif de Bordeaux, pour iOS, Android et le web. Un seul code, en TypeScript, avec
[Expo](https://expo.dev) (SDK 57) et Expo Router. Deux espaces :

- **Acheteur** (ouvert aux visiteurs) : accueil et recherche, détail d'un événement, réservation, mes billets (QR code), tableau de bord, compte.
- **Organisateur** (cloisonné par collectif) : ses événements, création et modification, affiche, annulation, tableau de bord des ventes.

Ce dépôt ne contient **que l'application**. Aucune donnée n'est écrite dans le code : tout vient d'un serveur (voir « L'API attendue »).

## Lancer

```bash
npm install
cp .env.example .env     # puis renseigner EXPO_PUBLIC_API_URL (l'adresse du serveur)
npx expo start           # « w » pour le web ; ou Expo Go / un émulateur
```

Après chaque changement du `.env` : `npx expo start --clear`. Sur un téléphone, `localhost` est le téléphone lui-même : mettre
l'adresse de l'ordinateur sur le réseau.

Avant de livrer : `npx tsc --noEmit` et `npx expo lint`.

## Où est quoi

| Dossier | Rôle |
| --- | --- |
| `src/app/` | Les écrans (une route par fichier, Expo Router) : `(buyer)/`, `organizer/`, connexion, inscription, liens reçus par e-mail, pages légales |
| `src/services/` | **Le seul endroit qui parle au serveur** (`api.ts` : jeton, erreurs, délais). Les écrans passent toujours par là |
| `src/types/` | La forme exacte de chaque réponse du serveur |
| `src/context/` | Qui est connecté (`auth`), réglages du site (`site`) |
| `src/hooks/use-load.ts` | Lecture de données avec chargement, erreur et « Réessayer » |
| `src/components/` | Composants (`ui/` : le kit : boutons, champs, cartes…) |

Le jeton de connexion est gardé dans le trousseau sécurisé de l'appareil (`expo-secure-store`) ; sur le web, dans `localStorage`.

## L'API attendue

L'application appelle `EXPO_PUBLIC_API_URL` + `/api/v1/…`. Les formes des réponses sont dans `src/types/`, les appels dans
`src/services/`. Les prix sont en unités de la monnaie (20 = 20 €), les horaires dans le fuseau de l'événement
(`date` + `startTime`) avec l'instant exact en `startsAt` (UTC). Les identifiants sont du texte.

**Erreurs** : toujours `{ "error": "<code>", "message": "<texte en français>", "fields"?: { "<champ>": "<message>" } }`.
`fields` a les mêmes clés que les formulaires (`name`, `tickets.0.price`…). Un `401` de code `unauthorized` déconnecte l'application.
Un événement, billet ou collectif inconnu **ou qui n'est pas à la personne** répond le même `404`.

**Authentification** : `Authorization: Bearer <jeton>`, jeton reçu à la connexion ou à l'inscription.

| Méthode et adresse | Accès | Réponse |
| --- | --- | --- |
| `GET /events/` · `GET /events/<id>/` · `GET /events/<id>/ticket-types/` | public | `{results: Event[]}` · `Event` · `{results: TicketType[]}` (publiés, non annulés) |
| `GET /site/` · `GET /pages/<slug>/` | public | `SiteInfo` (contact, pages légales, règles de réservation) · `LegalPage` |
| `POST /auth/register/` `{username, email, password, acceptTerms, newsletter?}` | public | `201` `AuthSession` |
| `POST /auth/login/` `{username, password}` | public | `AuthSession` |
| `POST /auth/logout/` · `POST /auth/resend-verification/` | connecté | `204` |
| `POST /auth/verify-email/` `{token}` | public | `{verified: true}` |
| `POST /auth/password-reset/` `{email}` · `POST /auth/password-reset/confirm/` `{uid, token, password}` | public | `204` (même réponse que l'adresse existe ou non) |
| `GET /me/` | connecté | `User` |
| `POST /events/<id>/reservations/` `{items: [{ticketTypeId, quantity}], paymentMethod}` | connecté, e-mail vérifié | `201` `PendingOrderDetails` |
| `GET /me/tickets/` · `GET /me/tickets/<id>/` · `GET /me/reservations/` | connecté | `{results: TicketDetails[]}` · `TicketDetails` · `{results: PendingOrderDetails[]}` |
| `GET` / `POST /organizer/events/` (`?collectiveId=`) | organisateur | `{results: Event[]}` (brouillons et annulés compris) · `201` `Event` |
| `GET` / `PUT` / `DELETE /organizer/events/<id>/` | organisateur | `Event` · `Event` · `204` (brouillon seulement) |
| `GET /organizer/events/<id>/ticket-types/` | organisateur | `{results: OrganizerTicketType[]}` (avec `sold`, `held`) |
| `POST /organizer/events/<id>/cancel/` | organisateur | `Event` (billets annulés, paiements reçus « à rembourser ») |
| `GET /organizer/events/<id>/stats/` · `GET /organizer/summary/` (`?collectiveId=`) | organisateur | `EventStats` · `{results: CollectiveSummary[]}` (une ligne par monnaie) |
| `POST /organizer/events/<id>/image/` (formulaire : `image_principale`, `image_principale_alt`) · `DELETE` | organisateur | `Event` · `204` |

Codes d'erreur que l'application sait expliquer : `validation`, `invalid_credentials`, `too_many_attempts`, `invalid_link`,
`email_not_verified`, `sold_out`, `too_many_pending`, `event_over`, `not_editable`, `not_cancellable`, `not_deletable`.

Le paiement en ligne n'existe pas encore : une réservation bloque les places jusqu'à `expiresAt`, puis elles sont rendues.

## Historique

Une première implémentation de ce serveur (Django, dossier `backend/`) existe dans l'historique git, au commit `ea6b31e`
(`git show ea6b31e --stat`, ou `git checkout ea6b31e -- backend`). Elle n'est plus dans le projet.
