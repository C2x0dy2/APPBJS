// Un type de place (Fosse, Balcon, VIP…), tel que le renvoie le serveur. Les prix sont en unités de la monnaie de
// l'événement (20 = 20 €). Un test compare ce fichier à la réponse réelle du serveur.
export interface TicketType {
    id: string;
    eventId: string;
    name: string;
    price: number; // le prix normal
    quantity: number; // le nombre de places mises en vente
    earlyPrice?: number; // le tarif early encore valable : ABSENT quand il n'y en a pas (ou plus)
    earlyPriceDeadline?: string;
    currentPrice: number; // le prix facturé maintenant (l'horloge du serveur fait foi) : earlyPrice s'il s'applique, sinon price
    remaining: number | null; // places restantes, donné seulement quand il en reste peu ; null sinon (on ne dévoile pas les ventes)
    soldOut: boolean;
}

// Ce que voit un organisateur en plus : les ventes de ce type de place.
export interface OrganizerTicketType extends TicketType {
    sold: number; // places payées
    held: number; // réservées, pas encore payées
}
