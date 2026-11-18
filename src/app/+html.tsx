import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { BRAND } from '../constants/brand';

// Le squelette de la page web : titre de l'onglet, description, couleur de la barre du navigateur sur mobile.
// (Ce fichier ne sert qu'au web ; il est évalué côté serveur à la construction du site.)
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>{`${BRAND.name} – ${BRAND.tagline}`}</title>
        <meta name="description" content={BRAND.tagline} />
        <meta name="theme-color" content="#6A1FC9" />

        {/* Désactive le défilement de la page elle-même : chaque écran gère le sien. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
