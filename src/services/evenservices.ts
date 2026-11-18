import { supabase } from "../lib/supabase";
import { Event } from "../types/even";
import { TicketType } from "../types/ticket";
import { mapEvent, mapTicketType } from "./mappers";
import { mapSupabaseError, orNotFound } from "./api";

// Les événements VISIBLES DU PUBLIC : publiés (en vente, complets ou terminés), jamais un brouillon ni un annulé —
// la RLS de la base l'impose de toute façon (voir supabase/migrations/0001_schema.sql), ceci n'est qu'un filtre en
// plus côté lecture. Les écrans passent TOUJOURS par ces fonctions, jamais par un accès direct à Supabase.

const PUBLIC_SELECT = "*, collectives(name), ticket_types(*)";

// Ne révèle le nombre de places restantes que s'il en reste peu, comme avant : pas de chiffre de vente public.
const REMAINING_VISIBLE_BELOW = 10;

export async function getPublicEvents(): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select(PUBLIC_SELECT)
    .in("status", ["on_sale", "sold_out", "completed"])
    .order("starts_at", { ascending: true });
  if (error) throw mapSupabaseError(error);
   
  return (data ?? []).map((row: any) => mapEvent(row));
}

export function getEventById(id: string): Promise<Event | null> {
  return orNotFound(
    (async () => {
      const { data, error } = await supabase
        .from("events")
        .select(PUBLIC_SELECT)
        .eq("id", id)
        .in("status", ["on_sale", "sold_out", "completed"])
        .single();
      if (error) throw mapSupabaseError(error);
       
      return mapEvent(data as any);
    })()
  );
}

export async function getTicketTypes(eventId: string): Promise<TicketType[]> {
  const { data: rows, error } = await supabase.from("ticket_types").select("*").eq("event_id", eventId);
  if (error) throw mapSupabaseError(error);

  const { data: availability } = await supabase.rpc("get_event_ticket_availability", { p_event_id: eventId });
  const remainingByType = new Map<string, number>(
    ((availability ?? []) as { ticket_type_id: string; available: number }[]).map((a) => [a.ticket_type_id, a.available])
  );

   
  return (rows ?? []).map((row: any) => {
    const ticketType = mapTicketType(row);
    const remaining = remainingByType.get(row.id);
    if (remaining === undefined) return ticketType;
    return {
      ...ticketType,
      remaining: remaining <= REMAINING_VISIBLE_BELOW ? Math.max(remaining, 0) : null,
      soldOut: remaining <= 0,
    };
  });
}
