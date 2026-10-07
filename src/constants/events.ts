import { Event } from "../types/even";
import { TicketType } from "../types/ticket";

// Deux collectifs pour tester le cloisonnement : chacun ne voit que ses événements.
export const collectives = [
  { id: "col-1", name: "Collectif Bordeaux Live" },
  { id: "col-2", name: "Collectif Jazz en ligne" },
];

// Données fictives : elles seront remplacées par l'API du backend.
export const events: Event[] = [
  {
    id: "event-1",
    collectiveId: "col-1",
    name: "Concert de Tayc",
    location: "Stade de France",
    date: "2026-11-18",
    startTime: "20:00",
    doorsOpenTime: "19:00",
    timezone: "Europe/Paris",
    currency: "EUR",
    cancellationDeadline: "2026-11-17",
    status: "on_sale",
  },
  {
    id: "event-2",
    collectiveId: "col-1",
    name: "Soirée Afro House",
    location: "Le Rocher de Palmer, Bordeaux",
    date: "2026-12-05",
    startTime: "23:00",
    doorsOpenTime: "22:30",
    timezone: "Europe/Paris",
    currency: "EUR",
    cancellationDeadline: "2026-12-03",
    status: "sold_out",
  },
  {
    id: "event-3",
    collectiveId: "col-2",
    name: "Live en ligne : Jazz Session",
    location: "En ligne",
    date: "2027-01-15",
    startTime: "21:00",
    doorsOpenTime: "20:45",
    timezone: "Europe/Paris",
    currency: "XOF",
    cancellationDeadline: "2027-01-14",
    status: "on_sale",
  },
  {
    id: "event-4",
    collectiveId: "col-1",
    name: "Soirée Électro de printemps",
    location: "La Rock School Barbey, Bordeaux",
    date: "2027-04-10",
    startTime: "22:00",
    doorsOpenTime: "21:30",
    timezone: "Europe/Paris",
    currency: "EUR",
    cancellationDeadline: "2027-04-08",
    status: "draft",
  },
];

export const ticketTypes: TicketType[] = [
  { id: "t-1", eventId: "event-1", name: "Fosse", price: 20, quantity: 400, earlyPrice: 15, earlyPriceDeadline: "2026-10-31" },
  { id: "t-2", eventId: "event-1", name: "Balcon", price: 30, quantity: 150 },
  { id: "t-3", eventId: "event-1", name: "VIP", price: 40, quantity: 50 },
  { id: "t-4", eventId: "event-2", name: "Standard", price: 12, quantity: 200 },
  { id: "t-5", eventId: "event-2", name: "VIP", price: 25, quantity: 30 },
  { id: "t-6", eventId: "event-3", name: "Accès live", price: 5000, quantity: 500 },
  { id: "t-7", eventId: "event-3", name: "Accès live + replay", price: 8000, quantity: 500 },
  { id: "t-8", eventId: "event-4", name: "Standard", price: 15, quantity: 250, earlyPrice: 10, earlyPriceDeadline: "2027-02-28" },
  { id: "t-9", eventId: "event-4", name: "VIP", price: 30, quantity: 40 },
];
