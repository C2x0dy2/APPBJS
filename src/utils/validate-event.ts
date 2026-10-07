import { EditedTicketType } from "../services/evenservices";
import { EvenStatus, Event } from "../types/even";
import { TicketType } from "../types/ticket";
import { DEFAULT_CURRENCY } from "../constants/currencies";
import { currencyDecimals } from "./format";

// Dans un formulaire, tout ce que l'on tape est du texte : on garde donc des string ici,
// et on ne convertit en nombres qu'une fois que tout est valide.
export interface TicketForm {
  id?: string; // présent seulement pour une place qui existe déjà (modification)
  name: string;
  price: string;
  quantity: string;
  earlyPrice: string;
  earlyPriceDeadline: string;
}

export interface EventForm {
  name: string;
  location: string;
  date: string;
  startTime: string;
  doorsOpenTime: string;
  timezone: string;
  currency: string;
  cancellationDeadline: string;
  status: EvenStatus;
  tickets: TicketForm[];
}

export const emptyTicket: TicketForm = {
  name: "",
  price: "",
  quantity: "",
  earlyPrice: "",
  earlyPriceDeadline: "",
};

// Formulaire de création : vide, avec deux lignes de places (l'énoncé : au moins deux types).
export const emptyEventForm: EventForm = {
  name: "",
  location: "",
  date: "",
  startTime: "",
  doorsOpenTime: "",
  timezone: "Europe/Paris",
  currency: DEFAULT_CURRENCY,
  cancellationDeadline: "",
  status: "draft",
  tickets: [emptyTicket, emptyTicket],
};

// Modification : on pré-remplit le formulaire avec l'événement existant (nombres -> texte).
export function eventToForm(event: Event, tickets: TicketType[]): EventForm {
  return {
    name: event.name,
    location: event.location,
    date: event.date,
    startTime: event.startTime,
    doorsOpenTime: event.doorsOpenTime,
    timezone: event.timezone,
    currency: event.currency,
    cancellationDeadline: event.cancellationDeadline,
    status: event.status,
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      name: ticket.name,
      price: String(ticket.price),
      quantity: String(ticket.quantity),
      earlyPrice: ticket.earlyPrice !== undefined ? String(ticket.earlyPrice) : "",
      earlyPriceDeadline: ticket.earlyPriceDeadline ?? "",
    })),
  };
}

// Envoi : texte -> nombres. À appeler seulement quand validateEvent n'a rien trouvé.
export function formToTickets(tickets: TicketForm[]): EditedTicketType[] {
  return tickets.map((ticket) => ({
    id: ticket.id,
    name: ticket.name.trim(),
    price: parseNumber(ticket.price),
    quantity: parseNumber(ticket.quantity),
    earlyPrice: ticket.earlyPrice ? parseNumber(ticket.earlyPrice) : undefined,
    earlyPriceDeadline: ticket.earlyPriceDeadline || undefined,
  }));
}

// Clé = nom du champ ("name", "tickets.0.price"...), valeur = message à afficher sous le champ.
export type FormErrors = Record<string, string>;

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/; // 2026-11-18
const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/; // 20:00 (00:00 à 23:59)

function isValidDate(value: string): boolean {
  // Le format seul ne suffit pas : "2026-02-31" a le bon format mais n'existe pas.
  if (!DATE_FORMAT.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const CURRENCY_FORMAT = /^[A-Z]{3}$/; // code ISO 4217 : XOF, EUR, USD...

function isValidCurrency(code: string): boolean {
  if (!CURRENCY_FORMAT.test(code)) return false;
  // Liste officielle quand le moteur JS la fournit ; sinon on se contente du format.
  const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return supportedValuesOf ? supportedValuesOf("currency").includes(code) : true;
}

// Trop de décimales pour la devise ? (ex. 1500,50 F CFA alors que le franc CFA n'a pas de centimes)
function hasTooManyDecimals(value: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(value * factor) - value * factor) > 1e-6;
}

// "12,50" -> 12.5 ; texte vide ou invalide -> NaN
export function parseNumber(value: string): number {
  return value.trim() === "" ? NaN : Number(value.replace(",", "."));
}

export function validateEvent(form: EventForm): FormErrors {
  const errors: FormErrors = {};

  if (!form.name.trim()) errors.name = "Le nom est obligatoire.";
  if (!form.location.trim()) errors.location = "Le lieu est obligatoire.";

  if (!isValidDate(form.date)) errors.date = "Date invalide (format AAAA-MM-JJ).";
  if (!TIME_FORMAT.test(form.startTime)) errors.startTime = "Heure invalide (format HH:MM).";
  if (!TIME_FORMAT.test(form.doorsOpenTime)) errors.doorsOpenTime = "Heure invalide (format HH:MM).";

  // On compare seulement si les deux heures sont valides. "19:00" < "20:00" marche
  // directement sur du texte parce que le format a toujours 2 chiffres.
  if (!errors.startTime && !errors.doorsOpenTime && form.doorsOpenTime > form.startTime) {
    errors.doorsOpenTime = "Les portes doivent ouvrir avant le début.";
  }

  if (!isValidDate(form.cancellationDeadline)) {
    errors.cancellationDeadline = "Date invalide (format AAAA-MM-JJ).";
  } else if (!errors.date && form.cancellationDeadline > form.date) {
    errors.cancellationDeadline = "Doit être avant ou le jour de l'événement.";
  }

  const currencyOk = isValidCurrency(form.currency);
  if (!currencyOk) errors.currency = "Code devise inconnu (3 lettres ISO, ex. XOF, EUR, USD).";
  const decimals = currencyOk ? currencyDecimals(form.currency) : 2;
  const decimalsError = decimals === 0 ? "Pas de centimes pour cette devise." : `${decimals} décimales maximum.`;

  // --- Types de places ---
  if (form.tickets.length < 2) {
    errors.tickets = "Il faut au moins deux types de places.";
  }

  const names = form.tickets.map((ticket) => ticket.name.trim().toLowerCase());

  form.tickets.forEach((ticket, i) => {
    const key = `tickets.${i}`; // préfixe des erreurs de cette ligne

    if (!ticket.name.trim()) {
      errors[`${key}.name`] = "Nom obligatoire.";
    } else if (names.indexOf(names[i]) !== i) {
      errors[`${key}.name`] = "Ce nom existe déjà dans cet événement.";
    }

    const price = parseNumber(ticket.price);
    if (isNaN(price) || price <= 0) errors[`${key}.price`] = "Prix supérieur à 0.";
    else if (hasTooManyDecimals(price, decimals)) errors[`${key}.price`] = decimalsError;

    const quantity = parseNumber(ticket.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors[`${key}.quantity`] = "Nombre entier supérieur à 0.";
    }

    // Tarif early : facultatif, mais prix ET date vont ensemble.
    const hasEarlyPrice = ticket.earlyPrice.trim() !== "";
    const hasEarlyDeadline = ticket.earlyPriceDeadline.trim() !== "";

    if (hasEarlyPrice !== hasEarlyDeadline) {
      errors[`${key}.earlyPrice`] = "Remplir le prix early ET sa date de fin, ou aucun des deux.";
    } else if (hasEarlyPrice) {
      const earlyPrice = parseNumber(ticket.earlyPrice);
      if (isNaN(earlyPrice) || earlyPrice <= 0) {
        errors[`${key}.earlyPrice`] = "Prix early supérieur à 0.";
      } else if (hasTooManyDecimals(earlyPrice, decimals)) {
        errors[`${key}.earlyPrice`] = decimalsError;
      } else if (!isNaN(price) && earlyPrice >= price) {
        errors[`${key}.earlyPrice`] = "Le prix early doit être moins cher que le prix normal.";
      }

      if (!isValidDate(ticket.earlyPriceDeadline)) {
        errors[`${key}.earlyPriceDeadline`] = "Date invalide (format AAAA-MM-JJ).";
      } else if (!errors.date && ticket.earlyPriceDeadline > form.date) {
        errors[`${key}.earlyPriceDeadline`] = "Doit finir avant l'événement.";
      }
    }
  });

  return errors;
}
