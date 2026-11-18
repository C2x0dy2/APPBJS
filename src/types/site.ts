// Ce que l'application sait du site, et que l'administrateur règle côté serveur (GET /api/v1/site/ et /api/v1/pages/<slug>/).

// Un lien vers une page de texte (CGV, politique de confidentialité…).
export interface PageLink {
  slug: string;
  title: string;
}

export interface SiteInfo {
  // Les textes valent null tant que l'administrateur ne les a pas saisis : l'application n'affiche alors rien.
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  termsPage: PageLink | null; // les conditions générales de vente, si elles sont publiées
  privacyPage: PageLink | null;
  // Les règles de réservation viennent du serveur : l'application ne les recopie pas.
  maxTicketsPerOrder: number;
  defaultCurrency: string; // la monnaie proposée à la création d'un événement
  defaultTimezone: string; // le fuseau proposé à la création d'un événement
}

export interface LegalPage {
  slug: string;
  title: string;
  content: string; // du texte brut ; les retours à la ligne sont à conserver
  updatedAt: string; // ISO
}
