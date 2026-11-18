import { PendingOrderDetails, TicketDetails } from "../types/order";
import { apiRequest, orNotFound } from "./api";

// Les billets et réservations de l'ACHETEUR connecté. Le serveur sait qui est la personne grâce à son jeton :
// il ne renvoie jamais que SES billets, jamais ceux d'un autre compte.

// Les événements les plus proches d'abord (l'écran inverse l'ordre pour les billets passés).
export async function getMyTickets(): Promise<TicketDetails[]> {
  const { results } = await apiRequest<{ results: TicketDetails[] }>("/me/tickets/");
  return results;
}

// null : ce billet n'existe pas, ou il appartient à un autre compte (le serveur répond pareil dans les deux cas).
export function getTicketDetails(ticketId: string): Promise<TicketDetails | null> {
  return orNotFound(apiRequest<TicketDetails>(`/me/tickets/${encodeURIComponent(ticketId)}/`));
}

// Les réservations pas encore payées, dont les places sont encore bloquées.
export async function getMyPendingOrders(): Promise<PendingOrderDetails[]> {
  const { results } = await apiRequest<{ results: PendingOrderDetails[] }>("/me/reservations/");
  return results;
}

export interface ReservationItem {
  ticketTypeId: string;
  quantity: number;
}

// Réserve des places : le serveur les bloque le temps du délai de paiement, puis les rend si rien n'est payé.
// Refus possibles (ApiError.code) : "email_not_verified", "sold_out", "too_many_pending", "event_over", "validation".
export function reserveTickets(eventId: string, items: ReservationItem[], paymentMethod: "card" | "transfer" = "card"): Promise<PendingOrderDetails> {
  return apiRequest<PendingOrderDetails>(`/events/${encodeURIComponent(eventId)}/reservations/`, {
    method: "POST",
    body: { items, paymentMethod },
  });
}
