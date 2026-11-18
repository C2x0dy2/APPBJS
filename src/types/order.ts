// Les billets et réservations d'un acheteur.
// Les noms suivent ceux du serveur : Billet (valide / utilisé / annulé), Commande (en attente / payée / expirée / annulée).
import { Event } from "./even";
import { TicketType } from "./ticket";

export type TicketStatus = "valid" | "used" | "canceled";

// Un billet = un QR code unique, scanné une seule fois à l'entrée.
export interface Ticket {
  id: string;
  eventId: string;
  ticketTypeId: string;
  orderId: string;
  code: string; // le contenu du QR code : secret, il ne sert qu'à l'entrée
  status: TicketStatus;
  usedAt?: string; // date et heure du scan (ISO), seulement si status = "used"
}

// Un billet avec tout ce qu'il faut pour l'afficher : son événement et son type de place.
export interface TicketDetails {
  ticket: Ticket;
  event: Event;
  ticketType: TicketType;
}

// Une réservation pas encore payée : les places sont bloquées jusqu'à expiresAt, puis rendues à la vente.
export interface PendingOrder {
  id: string;
  eventId: string;
  expiresAt: string; // ISO
  paymentMethod: "card" | "transfer";
  lines: { ticketTypeId: string; quantity: number }[];
}

export interface OrderLine {
  ticketType: TicketType;
  quantity: number;
  unitPrice: number; // le prix figé au moment de la réservation
}

export interface PendingOrderDetails {
  order: PendingOrder;
  event: Event;
  lines: OrderLine[];
  total: number; // dans la monnaie de l'événement
}
