import { Event } from "../types/even";
import { TicketType } from "../types/ticket";
import { apiRequest, orNotFound } from "./api";

// Les événements VISIBLES DU PUBLIC, tels que le serveur les renvoie : publiés, pas annulés. Les écrans passent TOUJOURS
// par ces fonctions, jamais par fetch directement. Aucun brouillon n'arrive jamais ici, quoi qu'on demande.

// Les événements à venir, du plus proche au plus lointain.
export async function getPublicEvents(): Promise<Event[]> {
  const { results } = await apiRequest<{ results: Event[] }>("/events/", { auth: false });
  return results;
}

// null : cet événement n'existe pas (ou n'est pas public) : le serveur répond pareil dans les deux cas.
export function getEventById(id: string): Promise<Event | null> {
  return orNotFound(apiRequest<Event>(`/events/${encodeURIComponent(id)}/`, { auth: false }));
}

export async function getTicketTypes(eventId: string): Promise<TicketType[]> {
  const { results } = await apiRequest<{ results: TicketType[] }>(`/events/${encodeURIComponent(eventId)}/ticket-types/`, { auth: false });
  return results;
}
