import { supabase } from "../lib/supabase";
import { Event } from "../types/even";
import { PendingOrderDetails, TicketDetails } from "../types/order";
import { TicketType } from "../types/ticket";
import { ApiError, mapSupabaseError, orNotFound } from "./api";
import { getEventById } from "./evenservices";
import { mapTicketType } from "./mappers";

// Les billets et réservations de l'ACHETEUR CONNECTÉ : reserve_seats_multi/get_my_tickets/get_my_pending_orders
// (voir supabase/migrations/0014_accounts_and_stats.sql) ne renvoient jamais que SES propres données — Postgres le
// garantit (auth.uid()), pas seulement l'écran.

async function fetchEventsByIds(ids: string[]): Promise<Map<string, Event>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, Event>();
  await Promise.all(
    unique.map(async (id) => {
      const event = await getEventById(id);
      if (event) map.set(id, event);
    })
  );
  return map;
}

async function fetchTicketTypesByIds(ids: string[]): Promise<Map<string, TicketType>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from("ticket_types").select("*").in("id", unique);
  if (error) throw mapSupabaseError(error);
  const map = new Map<string, TicketType>();
   
  for (const row of (data ?? []) as any[]) map.set(row.id, mapTicketType(row));
  return map;
}

export async function getMyTickets(): Promise<TicketDetails[]> {
  const { data, error } = await supabase.rpc("get_my_tickets");
  if (error) throw mapSupabaseError(error);
  type Row = {
    ticket_id: string;
    qr_code: string;
    ticket_status: "valid" | "used" | "cancelled";
    used_at: string | null;
    event_id: string;
    ticket_type_id: string;
    order_id: string;
  };
  const rows = (data ?? []) as Row[];
  const [events, ticketTypes] = await Promise.all([
    fetchEventsByIds(rows.map((r) => r.event_id)),
    fetchTicketTypesByIds(rows.map((r) => r.ticket_type_id)),
  ]);

  return rows
    .map((row): TicketDetails | null => {
      const event = events.get(row.event_id);
      const ticketType = ticketTypes.get(row.ticket_type_id);
      if (!event || !ticketType) return null;
      return {
        ticket: {
          id: row.ticket_id,
          eventId: row.event_id,
          ticketTypeId: row.ticket_type_id,
          orderId: row.order_id,
          code: row.qr_code,
          status: row.ticket_status === "cancelled" ? "canceled" : row.ticket_status,
          usedAt: row.used_at ?? undefined,
        },
        event,
        ticketType,
      };
    })
    .filter((t): t is TicketDetails => t !== null);
}

export function getTicketDetails(ticketId: string): Promise<TicketDetails | null> {
  return orNotFound(
    (async () => {
      const tickets = await getMyTickets();
      const found = tickets.find((t) => t.ticket.id === ticketId);
      if (!found) throw new ApiError(404, "not_found", "Introuvable.");
      return found;
    })()
  );
}

export async function getMyPendingOrders(): Promise<PendingOrderDetails[]> {
  const { data, error } = await supabase.rpc("get_my_pending_orders");
  if (error) throw mapSupabaseError(error);
  type Row = {
    order_id: string;
    event_id: string;
    expires_at: string;
    payment_method: "card" | "transfer";
    currency: string;
    total_cents: number;
    ticket_type_id: string;
    quantity: number;
    unit_price_cents: number;
  };
  const rows = (data ?? []) as Row[];
  const events = await fetchEventsByIds(rows.map((r) => r.event_id));
  const ticketTypes = await fetchTicketTypesByIds(rows.map((r) => r.ticket_type_id));

  const byOrder = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }

  const result: PendingOrderDetails[] = [];
  for (const [orderId, lines] of byOrder) {
    const first = lines[0];
    const event = events.get(first.event_id);
    if (!event) continue;
    result.push({
      order: {
        id: orderId,
        eventId: first.event_id,
        expiresAt: first.expires_at,
        paymentMethod: first.payment_method,
        lines: lines.map((l) => ({ ticketTypeId: l.ticket_type_id, quantity: l.quantity })),
      },
      event,
      lines: lines
        .map((l) => {
          const ticketType = ticketTypes.get(l.ticket_type_id);
          if (!ticketType) return null;
          return { ticketType, quantity: l.quantity, unitPrice: l.unit_price_cents / 100 };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null),
      total: first.total_cents / 100,
    });
  }
  return result;
}

export interface ReservationItem {
  ticketTypeId: string;
  quantity: number;
}

// Réserve des places : le serveur les bloque le temps du délai de paiement, puis les rend si rien n'est payé.
// Refus possibles (ApiError.code) : "not_authenticated", "sold_out", "event_not_on_sale", "event_over".
export async function reserveTickets(
  eventId: string,
  items: ReservationItem[],
  paymentMethod: "card" | "transfer" = "card"
): Promise<PendingOrderDetails> {
  const { error } = await supabase.rpc("reserve_seats_multi", {
    p_event_id: eventId,
    p_items: items.map((i) => ({ ticket_type_id: i.ticketTypeId, quantity: i.quantity })),
    p_payment_method: paymentMethod,
  });
  if (error) throw mapSupabaseError(error);

  const pending = await getMyPendingOrders();
  const order = pending.find((o) => o.order.eventId === eventId);
  if (!order) throw new ApiError(500, "server_error", "La réservation a été créée mais n'a pas pu être relue.");
  return order;
}

// Ouvre le paiement Stripe d'une réservation par carte en attente ; renvoie l'URL de la page de
// paiement à ouvrir dans un navigateur (expo-web-browser côté écran).
export async function payOrder(orderId: string): Promise<{ url: string }> {
  const returnUrl = typeof window !== "undefined" ? window.location.origin : undefined;
  const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>("create-checkout-session", {
    body: { order_id: orderId, success_url: returnUrl, cancel_url: returnUrl },
  });
  if (error || !data?.url) throw mapSupabaseError(error ?? new Error(data?.error ?? "checkout_failed"));
  return { url: data.url };
}
