import { Event, EvenStatus } from "../types/even";
import { TicketType } from "../types/ticket";

// Transforme les lignes brutes de Supabase (events/ticket_types, colonnes en centimes et en snake_case) vers les
// formes attendues par l'app (types/even.ts, types/ticket.ts). Un seul endroit pour ce calcul : le prix "dès", le
// tarif early encore valable, et le statut affiché (complet/terminé sont calculés, jamais stockés tels quels).

type RawTicketType = {
  id: string;
  event_id: string;
  name: string;
  quantity: number;
  price_cents: number;
  currency: string;
  early_price_cents: number | null;
  early_ends_at: string | null;
};

type RawEvent = {
  id: string;
  collective_id: string;
  name: string;
  venue: string | null;
  is_online: boolean;
  timezone: string;
  starts_at: string;
  doors_at: string | null;
  cancel_deadline_at: string | null;
  status: "draft" | "on_sale" | "sold_out" | "completed" | "cancelled";
  slug: string;
  collectives?: { name: string } | { name: string }[] | null;
  ticket_types?: RawTicketType[];
};

const STATUS_MAP: Record<RawEvent["status"], EvenStatus> = {
  draft: "draft",
  on_sale: "on_sale",
  sold_out: "sold_out",
  completed: "finished",
  cancelled: "canceled",
};

export function currentPriceCents(tt: Pick<RawTicketType, "price_cents" | "early_price_cents" | "early_ends_at">): number {
  if (tt.early_price_cents != null && tt.early_ends_at && new Date(tt.early_ends_at).getTime() > Date.now()) {
    return tt.early_price_cents;
  }
  return tt.price_cents;
}

// Formate un instant (UTC) en "AAAA-MM-JJ" / "HH:MM" dans le fuseau donné, sans dépendance de date externe.
function partsInTimezone(iso: string, timezone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function mapTicketType(tt: RawTicketType): TicketType {
  const hasEarly = tt.early_price_cents != null && tt.early_ends_at && new Date(tt.early_ends_at).getTime() > Date.now();
  return {
    id: tt.id,
    eventId: tt.event_id,
    name: tt.name,
    price: tt.price_cents / 100,
    quantity: tt.quantity,
    earlyPrice: hasEarly ? tt.early_price_cents! / 100 : undefined,
    earlyPriceDeadline: hasEarly ? tt.early_ends_at! : undefined,
    currentPrice: currentPriceCents(tt) / 100,
    remaining: null, // précision réelle seulement via get_event_ticket_availability (écran détail)
    soldOut: false,
  };
}

export function mapEvent(e: RawEvent): Event {
  const { date, time } = partsInTimezone(e.starts_at, e.timezone);
  const doors = e.doors_at ? partsInTimezone(e.doors_at, e.timezone).time : null;
  const collectiveName = Array.isArray(e.collectives) ? e.collectives[0]?.name : e.collectives?.name;
  const ticketTypes = e.ticket_types ?? [];
  const prices = ticketTypes.map((tt) => currentPriceCents(tt));

  return {
    id: e.id,
    collectiveId: e.collective_id,
    name: e.name,
    location: e.is_online ? "En ligne" : e.venue ?? "",
    date,
    startTime: time,
    doorsOpenTime: doors,
    timezone: e.timezone,
    currency: ticketTypes[0]?.currency ?? "EUR",
    cancellationDeadline: e.cancel_deadline_at ? partsInTimezone(e.cancel_deadline_at, e.timezone).date : "",
    status: STATUS_MAP[e.status],
    slug: e.slug,
    isOnline: e.is_online,
    collectiveName: collectiveName ?? "",
    startsAt: e.starts_at,
    cancellationDeadlineAt: e.cancel_deadline_at ?? "",
    fromPrice: prices.length > 0 ? Math.min(...prices) / 100 : null,
    image: null, // pas encore d'affiche d'événement côté Supabase (lot image non construit)
  };
}
