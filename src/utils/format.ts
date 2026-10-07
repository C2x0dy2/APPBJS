import { EvenStatus } from "../types/even";

// Texte affiché à l'utilisateur pour chaque statut (les codes restent en anglais dans les données).
export const statusLabels: Record<EvenStatus, string> = {
  draft: "Brouillon",
  on_sale: "En vente",
  sold_out: "Complet",
  finished: "Terminé",
  canceled: "Annulé",
};

// "2026-11-18" -> "mercredi 18 novembre 2026"
export function formatDate(date: string): string {
  // T12:00 évite qu'un décalage horaire fasse afficher le jour d'avant.
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Intl connaît toutes les devises ISO 4217 et leurs règles :
// formatPrice(15000, "XOF") -> "15 000 F CFA", formatPrice(20, "EUR") -> "20,00 €", formatPrice(20, "USD") -> "20,00 $US"
export function formatPrice(price: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(price);
}

// Nombre de décimales autorisées par la devise : 2 pour EUR/USD, 0 pour le franc CFA (pas de centimes).
export function currencyDecimals(currency: string): number {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
