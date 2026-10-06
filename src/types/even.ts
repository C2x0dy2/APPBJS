export type EvenStatus = 
| "draft"
| "on sale"
| "sold out"
| "canceled"
| "full"
| "finished";

export interface Event {
    id: string;
    name: string;
    location: string;
    date: string;
    startTime: string;
    doorsOpenTime: string;
    cancellationDeadline: string;
    status: EvenStatus;
}
