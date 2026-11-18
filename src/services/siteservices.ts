import { LegalPage, SiteInfo } from "../types/site";
import { apiRequest, orNotFound } from "./api";

// Ce que l'administrateur règle côté serveur : contact, pages légales, règles de réservation.
export function getSiteInfo(): Promise<SiteInfo> {
  return apiRequest<SiteInfo>("/site/", { auth: false });
}

// Une page de texte (CGV, confidentialité…). null si elle n'existe pas ou n'est pas publiée.
export function getLegalPage(slug: string): Promise<LegalPage | null> {
  return orNotFound(apiRequest<LegalPage>(`/pages/${encodeURIComponent(slug)}/`, { auth: false }));
}
