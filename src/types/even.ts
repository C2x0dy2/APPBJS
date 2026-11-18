// Les 5 statuts demandés : brouillon, en vente, complet, terminé, annulé.
// "sold_out" et "finished" sont calculés par le serveur (plus de place / date passée) : on ne les saisit jamais.
export type EvenStatus =
| "draft"
| "on_sale"
| "sold_out"
| "finished"
| "canceled";

// L'affiche d'un événement : plusieurs versions de la même image (comme un "srcset" web), pour charger la bonne taille.
export interface EventImage {
    url: string; // la version moyenne
    alt: string; // description pour les personnes qui ne voient pas l'image (obligatoire côté serveur)
    width: number | null;
    height: number | null;
    sources: { width: number; url: string }[]; // de la plus petite à la plus grande
}

// Un événement, tel que le renvoie le serveur (backend/ticketing/serialisation.py). Un test compare ce fichier à la
// réponse réelle : si l'un change sans l'autre, il échoue.
export interface Event {
    id: string;
    collectiveId: string; // le collectif organisateur : un organisateur ne voit que les siens
    name: string;
    location: string;
    date: string; // AAAA-MM-JJ, dans le fuseau de l'événement
    startTime: string; // HH:MM, dans le fuseau de l'événement
    doorsOpenTime: string | null; // null : l'organisateur ne l'a pas communiquée
    timezone: string;
    currency: string; // code ISO 4217 : "XOF" (franc CFA), "EUR", "USD"... tous les prix de l'événement sont dans cette devise
    cancellationDeadline: string;
    status: EvenStatus;
    slug: string;
    isOnline: boolean;
    collectiveName: string;
    startsAt: string; // l'instant exact du début (ISO, UTC) : date + startTime, sans ambiguïté de fuseau
    cancellationDeadlineAt: string; // idem pour la limite d'annulation
    fromPrice: number | null; // le prix "dès" : le plus bas des prix en vigueur ; null s'il n'y a aucune place à vendre
    image: EventImage | null;
}
