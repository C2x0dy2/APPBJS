import { events, ticketTypes } from "../constants/events";
import { Event } from "../types/even";
import { TicketType } from "../types/ticket";

// Les écrans passent TOUJOURS par ces fonctions, jamais directement par les données.
// Quand l'API Django sera prête, on remplacera seulement l'intérieur de ces fonctions
// par des fetch(), sans toucher aux écrans.

// --- Lecture ---

// Espace acheteur : seulement ce qui est visible du public (pas les brouillons ni les annulés).
export async function getPublicEvents(): Promise<Event[]> {
  return events.filter((event) => event.status === "on_sale" || event.status === "sold_out");
}

// Espace organisateur : tous les statuts, mais seulement SON collectif (cloisonnement).
export async function getCollectiveEvents(collectiveId: string): Promise<Event[]> {
  return events.filter((event) => event.collectiveId === collectiveId);
}

export async function getEventById(id: string): Promise<Event | undefined> {
  return events.find((event) => event.id === id);
}

export async function getTicketTypes(eventId: string): Promise<TicketType[]> {
  return ticketTypes.filter((ticket) => ticket.eventId === eventId);
}

// --- Écriture (organisateur) ---

// Ce que le formulaire envoie : tout sauf les id, qui sont donnés par le "serveur".
export type NewEvent = Omit<Event, "id">;
export type NewTicketType = Omit<TicketType, "id" | "eventId">;
// En modification, une place qui existait déjà garde son id ; une nouvelle n'en a pas.
export type EditedTicketType = NewTicketType & { id?: string };

export async function createEvent(data: NewEvent, newTickets: NewTicketType[]): Promise<Event> {
  // Date.now() donne un nombre unique à la milliseconde : suffisant pour des données fictives.
  // Avec Django, c'est la base de données qui fournira l'id.
  const event: Event = { ...data, id: `event-${Date.now()}` };
  events.push(event);

  newTickets.forEach((ticket, index) => {
    ticketTypes.push({ ...ticket, id: `${event.id}-t${index + 1}`, eventId: event.id });
  });

  return event;
}

export async function updateEvent(
  id: string,
  data: Omit<NewEvent, "collectiveId">, // on ne change jamais le collectif d'un événement
  editedTickets: EditedTicketType[]
): Promise<void> {
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) throw new Error("Événement introuvable");
  events[index] = { ...events[index], ...data };

  // 1. Supprimer les places retirées du formulaire.
  //    On parcourt à l'envers : supprimer un élément ne décale pas ceux qu'il reste à voir.
  const keptIds = editedTickets.map((ticket) => ticket.id).filter(Boolean);
  for (let i = ticketTypes.length - 1; i >= 0; i--) {
    if (ticketTypes[i].eventId === id && !keptIds.includes(ticketTypes[i].id)) {
      ticketTypes.splice(i, 1);
    }
  }

  // 2. Mettre à jour celles qui existaient, ajouter les nouvelles.
  editedTickets.forEach((ticket, i) => {
    if (ticket.id) {
      const existing = ticketTypes.findIndex((t) => t.id === ticket.id);
      ticketTypes[existing] = { ...ticket, id: ticket.id, eventId: id };
    } else {
      ticketTypes.push({ ...ticket, id: `${id}-t${Date.now()}-${i}`, eventId: id });
    }
  });
}

// Annuler = l'événement reste visible dans l'historique de l'organisateur, avec le statut "Annulé".
export async function cancelEvent(id: string): Promise<void> {
  const event = events.find((e) => e.id === id);
  if (event) event.status = "canceled";
}

// Supprimer = l'événement disparaît. Réservé aux brouillons : rien n'a pu être vendu.
export async function deleteEvent(id: string): Promise<void> {
  const index = events.findIndex((event) => event.id === id);
  if (index === -1 || events[index].status !== "draft") return;
  events.splice(index, 1);
  for (let i = ticketTypes.length - 1; i >= 0; i--) {
    if (ticketTypes[i].eventId === id) ticketTypes.splice(i, 1);
  }
}

// Prix à appliquer aujourd'hui : early si la date limite n'est pas passée.
export function currentPrice(ticket: TicketType): number {
  if (ticket.earlyPrice !== undefined && ticket.earlyPriceDeadline) {
    const today = new Date().toISOString().slice(0, 10);
    if (today <= ticket.earlyPriceDeadline) {
      return ticket.earlyPrice;
    }
  }
  return ticket.price;
}
