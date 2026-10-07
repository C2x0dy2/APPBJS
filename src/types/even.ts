// Les 5 statuts demandés : brouillon, en vente, complet, terminé, annulé.
export type EvenStatus =
| "draft"
| "on_sale"
| "sold_out"
| "finished"
| "canceled";

export interface Event {
    id: string;
    collectiveId: string; // le collectif organisateur : un organisateur ne voit que les siens
    name: string;
    location: string;
    date: string;
    startTime: string;
    doorsOpenTime: string;
    timezone: string;
    currency: string; // code ISO 4217 : "XOF" (franc CFA), "EUR", "USD"... tous les prix de l'événement sont dans cette devise
    cancellationDeadline: string;
    status: EvenStatus;
}
