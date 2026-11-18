// Les chiffres de vente de l'espace organisateur (tableau de bord). Les montants sont dans la monnaie de l'événement.
import { Event } from "./even";
import { OrganizerTicketType } from "./ticket";

export interface TypeStats {
  ticketType: OrganizerTicketType;
  sold: number; // places payées
  held: number; // réservées, pas encore payées
  free: number; // encore disponibles
  revenue: number; // argent encaissé pour ce type (hors paiements à rembourser)
}

export interface StatsTotals {
  capacity: number;
  sold: number;
  held: number;
  free: number;
  fillRate: number; // de 0 à 1
  revenue: number; // l'argent que le collectif garde : un événement annulé rapporte 0
}

// Des paiements à rendre : reçus trop tard (plus de place), ou événement annulé après le paiement.
export interface Refunds {
  count: number;
  amount: number;
}

export interface DailySales {
  date: string; // AAAA-MM-JJ
  tickets: number;
}

export interface EventStats {
  event: Event;
  types: TypeStats[];
  totals: StatsTotals;
  refunds: Refunds;
  entriesScanned: number;
  daily: DailySales[]; // les 14 derniers jours, le plus ancien d'abord
  generatedAt: string; // ISO
}

// Le total du collectif pour UNE monnaie : on n'additionne jamais des euros et des francs CFA.
export interface CollectiveSummary {
  currency: string;
  revenue: number;
  sold: number;
  refunds: Refunds;
}
