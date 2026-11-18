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

// --- Dates et nombres pour les cartes, les billets et les tableaux de bord ---

// "2026-11-18" -> une Date à midi (même précaution que formatDate : pas de décalage d'un jour).
function toDate(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

// "2026-11-18" -> "18"
export function formatDayNumber(date: string): string {
  return String(toDate(date).getDate());
}

// "2026-11-18" -> "NOV."
export function formatMonthShort(date: string): string {
  return toDate(date).toLocaleDateString("fr-FR", { month: "short" }).toUpperCase();
}

// "2026-11-18" -> "mer. 18 nov."
export function formatDateShort(date: string): string {
  return toDate(date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

// Un instant précis (ISO) -> "10 oct. 2026 à 22:41", dans l'heure de l'appareil.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day} à ${time}`;
}

// Jours entre aujourd'hui et la date : 0 = aujourd'hui, 1 = demain, négatif = passé.
export function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((toDate(date).getTime() - today.getTime()) / 86_400_000);
}

// "Aujourd'hui", "Demain", "Dans 3 jours"... ou null quand c'est trop loin pour être utile.
export function relativeDay(date: string): string | null {
  const days = daysUntil(date);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Demain";
  if (days > 1 && days <= 7) return `Dans ${days} jours`;
  return null;
}

// Un décompte : 754 000 ms -> "12:34" ; plus d'une heure -> "2 h 05".
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours} h ${two(minutes)}` : `${two(minutes)}:${two(seconds)}`;
}

// 12345 -> "12 345"
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}

// 0.874 -> "87 %"
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

// "2026-11-18" à partir d'une Date, dans l'heure de l'appareil.
export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
