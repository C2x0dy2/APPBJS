import { Event } from "../types/even";
import { daysUntil } from "./format";

// Un événement est "passé" s'il est terminé, annulé, ou si sa date est dépassée.
export function isPastEvent(event: Event): boolean {
  return event.status === "finished" || event.status === "canceled" || daysUntil(event.date) < 0;
}

// Les événements à venir d'abord (le plus proche en premier), puis les passés (le plus récent en premier).
export function sortUpcomingFirst(events: Event[]): Event[] {
  const upcoming = events.filter((event) => !isPastEvent(event)).sort((a, b) => a.date.localeCompare(b.date));
  const past = events.filter(isPastEvent).sort((a, b) => b.date.localeCompare(a.date));
  return [...upcoming, ...past];
}
