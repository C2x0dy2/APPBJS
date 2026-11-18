import { Platform } from "react-native";

import { Event } from "../types/even";
import { CollectiveSummary, EventStats } from "../types/organizer";
import { OrganizerTicketType } from "../types/ticket";
import { apiRequest, orNotFound } from "./api";

// L'espace ORGANISATEUR : les événements de son collectif, leurs chiffres de vente, et leur gestion.
// Le serveur cloisonne tout par collectif : un événement d'un autre collectif répond « introuvable », comme s'il n'existait pas.

// --- Ce que le formulaire envoie (backend/ticketing/gestion.py) ---

export interface TicketTypeInput {
  id?: string; // présent seulement pour une place qui existait déjà (modification)
  name: string;
  price: number;
  quantity: number;
  earlyPrice?: number;
  earlyPriceDeadline?: string;
}

export interface EventInput {
  name: string;
  location: string;
  date: string;
  startTime: string;
  doorsOpenTime: string; // "" : non communiquée
  timezone: string;
  currency: string;
  cancellationDeadline: string; // "" : le délai par défaut du site
  status: "draft" | "on_sale"; // "complet" et "terminé" sont calculés par le serveur : on ne les saisit pas
  ticketTypes: TicketTypeInput[];
}

// --- Lecture ---

// Tous les événements du collectif, brouillons et annulés compris.
export async function getCollectiveEvents(collectiveId?: string): Promise<Event[]> {
  const query = collectiveId ? `?collectiveId=${encodeURIComponent(collectiveId)}` : "";
  const { results } = await apiRequest<{ results: Event[] }>(`/organizer/events/${query}`);
  return results;
}

export function getOrganizerEvent(id: string): Promise<Event | null> {
  return orNotFound(apiRequest<Event>(`/organizer/events/${encodeURIComponent(id)}/`));
}

// Les types de place AVEC leurs ventes (sold, held) : réservé à l'organisateur.
export async function getOrganizerTicketTypes(eventId: string): Promise<OrganizerTicketType[]> {
  const { results } = await apiRequest<{ results: OrganizerTicketType[] }>(`/organizer/events/${encodeURIComponent(eventId)}/ticket-types/`);
  return results;
}

export function getEventStats(eventId: string): Promise<EventStats | null> {
  return orNotFound(apiRequest<EventStats>(`/organizer/events/${encodeURIComponent(eventId)}/stats/`));
}

// Le total du collectif, une ligne PAR MONNAIE (on n'additionne jamais des euros et des francs CFA).
export async function getCollectiveSummary(collectiveId?: string): Promise<CollectiveSummary[]> {
  const query = collectiveId ? `?collectiveId=${encodeURIComponent(collectiveId)}` : "";
  const { results } = await apiRequest<{ results: CollectiveSummary[] }>(`/organizer/summary/${query}`);
  return results;
}

// --- Écriture ---
// Un refus du serveur est une ApiError : `error.fields` a les mêmes clés que le formulaire ("name", "tickets.0.price"…).

export function createEvent(collectiveId: string, input: EventInput): Promise<Event> {
  return apiRequest<Event>("/organizer/events/", { method: "POST", body: { ...input, collectiveId } });
}

export function updateEvent(id: string, input: EventInput): Promise<Event> {
  return apiRequest<Event>(`/organizer/events/${encodeURIComponent(id)}/`, { method: "PUT", body: input });
}

// Annuler = plus aucune vente, les billets sont annulés et les paiements reçus sont à rembourser.
// L'événement reste dans l'historique de l'organisateur, avec le statut « Annulé ».
export function cancelEvent(id: string): Promise<Event> {
  return apiRequest<Event>(`/organizer/events/${encodeURIComponent(id)}/cancel/`, { method: "POST" });
}

// Supprimer = l'événement disparaît. Réservé aux brouillons sans réservation : un événement en vente s'annule.
export async function deleteEvent(id: string): Promise<void> {
  await apiRequest(`/organizer/events/${encodeURIComponent(id)}/`, { method: "DELETE" });
}

// --- Affiche ---

// L'image choisie dans la photothèque (ce que renvoie expo-image-picker).
export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  file?: File; // web seulement : le fichier lui-même
}

// Remplace l'affiche. Le serveur vérifie l'image (vraie image JPG/PNG/WebP, poids, dimensions minimales) et exige sa
// description (`alt`) : un refus est une ApiError dont `fields.image` / `fields.alt` expliquent quoi corriger.
export async function uploadEventImage(eventId: string, image: PickedImage, alt: string): Promise<Event> {
  const name = image.fileName || "affiche.jpg";
  const form = new FormData();
  form.append("image_principale_alt", alt.trim());
  if (Platform.OS === "web") {
    // Le navigateur envoie un fichier (Blob) ; l'adresse « blob: » de l'image choisie permet de le retrouver si le sélecteur n'en donne pas.
    form.append("image_principale", image.file ?? (await (await fetch(image.uri)).blob()), name);
  } else {
    // React Native sait envoyer un fichier à partir de son adresse locale.
    form.append("image_principale", { uri: image.uri, name, type: image.mimeType ?? "image/jpeg" } as unknown as Blob);
  }
  return apiRequest<Event>(`/organizer/events/${encodeURIComponent(eventId)}/image/`, { method: "POST", form, timeoutMs: 60_000 });
}

export async function removeEventImage(eventId: string): Promise<void> {
  await apiRequest(`/organizer/events/${encodeURIComponent(eventId)}/image/`, { method: "DELETE" });
}
