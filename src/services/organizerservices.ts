import { File as ExpoFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { supabase } from "../lib/supabase";
import { Event } from "../types/even";
import { CollectiveSummary, EventStats } from "../types/organizer";
import { OrganizerTicketType } from "../types/ticket";
import { ApiError, mapSupabaseError, orNotFound } from "./api";
import { mapEvent, mapTicketType } from "./mappers";

// L'espace ORGANISATEUR : les événements de son collectif, leurs chiffres de vente, et leur gestion. La RLS de la
// base (supabase/migrations/0001_schema.sql) cloisonne tout par collectif : un événement d'un autre collectif
// répond "introuvable", comme s'il n'existait pas — ce n'est pas cette couche qui protège les données.

const ORGANIZER_SELECT = "*, collectives(name), ticket_types(*)";

export interface TicketTypeInput {
  id?: string;
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
  doorsOpenTime: string;
  timezone: string;
  currency: string;
  cancellationDeadline: string;
  status: "draft" | "on_sale";
  ticketTypes: TicketTypeInput[];
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || "evenement"}-${Math.random().toString(36).slice(2, 8)}`;
}

// Combine une date/heure "locales" (AAAA-MM-JJ, HH:MM) avec un fuseau horaire. Approximatif : utilise le fuseau de
// l'APPAREIL (pas celui de l'événement) pour construire l'instant ; correct dans la grande majorité des cas (la
// personne qui crée l'événement est généralement dans son propre fuseau), mais une vraie conversion par fuseau
// (ex. création depuis un autre pays) demanderait une librairie de dates (date-fns-tz, luxon...), pas encore ajoutée.
function toInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

// --- Lecture ---

export async function getCollectiveEvents(collectiveId?: string): Promise<Event[]> {
  let query = supabase.from("events").select(ORGANIZER_SELECT).order("starts_at", { ascending: true });
  if (collectiveId) query = query.eq("collective_id", collectiveId);
  const { data, error } = await query;
  if (error) throw mapSupabaseError(error);
   
  return (data ?? []).map((row: any) => mapEvent(row));
}

export function getOrganizerEvent(id: string): Promise<Event | null> {
  return orNotFound(
    (async () => {
      const { data, error } = await supabase.from("events").select(ORGANIZER_SELECT).eq("id", id).single();
      if (error) throw mapSupabaseError(error);
       
      return mapEvent(data as any);
    })()
  );
}

export async function getOrganizerTicketTypes(eventId: string): Promise<OrganizerTicketType[]> {
  const { data: rows, error } = await supabase.from("ticket_types").select("*").eq("event_id", eventId);
  if (error) throw mapSupabaseError(error);

  const { data: availability } = await supabase.rpc("get_event_ticket_availability", { p_event_id: eventId });
  const availabilityByType = new Map<string, number>(
    ((availability ?? []) as { ticket_type_id: string; available: number }[]).map((a) => [a.ticket_type_id, a.available])
  );

   
  return (rows ?? []).map((row: any) => {
    const available = availabilityByType.get(row.id) ?? row.quantity;
    const sold = 0; // repris précisément depuis get_event_stats ; ici on ne garde que la disponibilité
    const held = Math.max(row.quantity - available - sold, 0);
    return { ...mapTicketType(row), remaining: available, soldOut: available <= 0, sold, held };
  });
}

export function getEventStats(eventId: string): Promise<EventStats | null> {
  return orNotFound(
    (async () => {
      const [{ data: stats, error }, event] = await Promise.all([
        supabase.rpc("get_event_stats", { p_event_id: eventId }),
        getOrganizerEvent(eventId),
      ]);
      if (error) throw mapSupabaseError(error);
      if (!event || !stats) throw new ApiError(404, "not_found", "Introuvable.");

      const ticketTypes = await getOrganizerTicketTypes(eventId);
      const byId = new Map(ticketTypes.map((t) => [t.id, t]));
      type RawTypeStat = { ticketTypeId: string; sold: number; held: number; free: number; revenue: number };

      return {
        event,
        types: (stats.types as RawTypeStat[]).map((t) => ({
          ticketType: byId.get(t.ticketTypeId) ?? ticketTypes[0],
          sold: t.sold,
          held: t.held,
          free: t.free,
          revenue: t.revenue / 100,
        })),
        totals: {
          capacity: stats.totals.capacity,
          sold: stats.totals.sold,
          held: stats.totals.held,
          free: stats.totals.free,
          fillRate: stats.totals.capacity ? stats.totals.sold / stats.totals.capacity : 0,
          revenue: stats.totals.revenue / 100,
        },
        refunds: { count: stats.refunds?.count ?? 0, amount: (stats.refunds?.amount ?? 0) / 100 },
        entriesScanned: stats.entriesScanned,
        daily: stats.daily ?? [],
        generatedAt: new Date().toISOString(),
      } satisfies EventStats;
    })()
  );
}

export async function getCollectiveSummary(collectiveId?: string): Promise<CollectiveSummary[]> {
  if (!collectiveId) return [];
  const { data, error } = await supabase.rpc("get_collective_summary", { p_collective_id: collectiveId });
  if (error) throw mapSupabaseError(error);
  type Row = { currency: string; revenue: number; sold: number; refund_count: number; refund_amount: number };
  return ((data ?? []) as Row[]).map((row) => ({
    currency: row.currency,
    revenue: row.revenue / 100,
    sold: row.sold,
    refunds: { count: row.refund_count, amount: row.refund_amount / 100 },
  }));
}

// --- Écriture ---

export async function createEvent(collectiveId: string, input: EventInput): Promise<Event> {
  const { data: eventRow, error } = await supabase
    .from("events")
    .insert({
      collective_id: collectiveId,
      name: input.name,
      venue: input.location,
      is_online: input.location.trim().toLowerCase() === "en ligne",
      timezone: input.timezone,
      starts_at: toInstant(input.date, input.startTime),
      doors_at: input.doorsOpenTime ? toInstant(input.date, input.doorsOpenTime) : null,
      cancel_deadline_at: input.cancellationDeadline ? `${input.cancellationDeadline}T23:59:59` : null,
      status: input.status,
      slug: slugify(input.name),
    })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);

  if (input.ticketTypes.length > 0) {
    const { error: ticketsError } = await supabase.from("ticket_types").insert(
      input.ticketTypes.map((t) => ({
        event_id: eventRow.id,
        name: t.name,
        quantity: t.quantity,
        price_cents: Math.round(t.price * 100),
        currency: input.currency,
        early_price_cents: t.earlyPrice != null ? Math.round(t.earlyPrice * 100) : null,
        early_ends_at: t.earlyPriceDeadline ? `${t.earlyPriceDeadline}T23:59:59` : null,
      }))
    );
    if (ticketsError) throw mapSupabaseError(ticketsError);
  }

  const event = await getOrganizerEvent(eventRow.id);
  if (!event) throw new ApiError(500, "server_error", "L'événement a été créé mais n'a pas pu être relu.");
  return event;
}

export async function updateEvent(id: string, input: EventInput): Promise<Event> {
  const { error } = await supabase
    .from("events")
    .update({
      name: input.name,
      venue: input.location,
      is_online: input.location.trim().toLowerCase() === "en ligne",
      timezone: input.timezone,
      starts_at: toInstant(input.date, input.startTime),
      doors_at: input.doorsOpenTime ? toInstant(input.date, input.doorsOpenTime) : null,
      cancel_deadline_at: input.cancellationDeadline ? `${input.cancellationDeadline}T23:59:59` : null,
      status: input.status,
    })
    .eq("id", id);
  if (error) throw mapSupabaseError(error);

  // Types de place : on garde ceux qui ont un id (modifiés), on crée les autres, et on ne supprime jamais ici
  // (une place déjà vendue ne doit jamais disparaître).
  for (const t of input.ticketTypes) {
    const payload = {
      event_id: id,
      name: t.name,
      quantity: t.quantity,
      price_cents: Math.round(t.price * 100),
      currency: input.currency,
      early_price_cents: t.earlyPrice != null ? Math.round(t.earlyPrice * 100) : null,
      early_ends_at: t.earlyPriceDeadline ? `${t.earlyPriceDeadline}T23:59:59` : null,
    };
    const { error: upsertError } = t.id
      ? await supabase.from("ticket_types").update(payload).eq("id", t.id)
      : await supabase.from("ticket_types").insert(payload);
    if (upsertError) throw mapSupabaseError(upsertError);
  }

  const event = await getOrganizerEvent(id);
  if (!event) throw new ApiError(500, "server_error", "L'événement a été modifié mais n'a pas pu être relu.");
  return event;
}

// Annule l'événement ENTIER (pas une commande) : libère les réservations en attente, invalide les billets, et
// déclenche le remboursement des commandes déjà payées par carte (voir Edge Function cancel-event + cancel_event()
// dans supabase/migrations/0016_entry_validation_and_event_cancellation.sql).
export async function cancelEvent(id: string): Promise<Event> {
  const { error } = await supabase.functions.invoke("cancel-event", { body: { event_id: id } });
  if (error) throw mapSupabaseError(error);
  const event = await getOrganizerEvent(id);
  if (!event) throw new ApiError(404, "not_found", "Introuvable.");
  return event;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw mapSupabaseError(error);
}

// --- Entrée ---

export type EntryValidationResult = "ok" | "already_used" | "invalid";

// Valide un billet à l'entrée (atomique, un seul code ne passe jamais deux fois). Même réponse ("invalid") pour un
// code inconnu, d'un autre événement ou d'un autre collectif : rien n'est révélé à qui scanne au hasard.
export async function validateTicketEntry(
  eventId: string,
  code: string
): Promise<{ result: EntryValidationResult; ticketType?: string }> {
  const { data, error } = await supabase.rpc("validate_ticket_entry", { p_event_id: eventId, p_code: code });
  if (error) throw mapSupabaseError(error);
  return { result: data.result, ticketType: data.ticketType ?? undefined };
}

// --- Export ---

function csvCell(value: string | number): string {
  const text = String(value);
  // Évite l'injection de formule quand le fichier est ouvert dans un tableur (=, +, -, @ en tête de cellule).
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// Construit le CSV des participants (rempli par l'appelant : nom de fichier, téléchargement...), l'app n'a qu'à
// l'enregistrer ou le partager — pas de dépendance à un serveur de fichiers.
export async function getParticipantsCsv(eventId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_event_participants", { p_event_id: eventId });
  if (error) throw mapSupabaseError(error);
  type Row = { email: string; ticket_type_name: string; ticket_number: number; ticket_status: string };
  const header = ["E-mail", "Type de place", "N° de billet", "Statut"].map(csvCell).join(",");
  const rows = ((data ?? []) as Row[]).map((r) =>
    [csvCell(r.email), csvCell(r.ticket_type_name), csvCell(r.ticket_number), csvCell(r.ticket_status)].join(",")
  );
  return ["﻿" + header, ...rows].join("\r\n"); // BOM : pour qu'Excel lise bien les accents
}

// Télécharge (web) ou partage (téléphone) directement le CSV : l'écran n'a qu'à appeler cette fonction.
export async function exportParticipants(eventId: string, fileName: string): Promise<void> {
  const csv = await getParticipantsCsv(eventId);

  if (Platform.OS === "web") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new ExpoFile(Paths.cache, `${fileName}.csv`);
  file.create({ overwrite: true });
  file.write(csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "Liste des participants" });
  }
}

// --- Affiche ---
// Pas encore construit côté Supabase (ni bucket de stockage, ni variantes d'image) : l'écran affiche l'erreur
// renvoyée ici plutôt que de prétendre que l'envoi a marché.

export interface PickedImage {
  uri: string;
  fileName?: string | null;
  mimeType?: string;
  file?: File;
}

export async function uploadEventImage(_eventId: string, _image: PickedImage, _alt: string): Promise<Event> {
  throw new ApiError(501, "not_implemented", "L'envoi d'affiche n'est pas encore disponible sur cette version.");
}

export async function removeEventImage(_eventId: string): Promise<void> {
  throw new ApiError(501, "not_implemented", "L'envoi d'affiche n'est pas encore disponible sur cette version.");
}
