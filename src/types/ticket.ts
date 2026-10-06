export interface TicketType {
    id: string;
    eventId: string;
    name: string;
    price: number;
    quantity: number;
    earlyPrice?: number;
    earlyPriceDeadline?: string;
}