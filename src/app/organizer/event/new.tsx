import { router } from "expo-router";

import { EventForm } from "@/components/event-form";
import { useAuth } from "@/context/auth";
import { createEvent } from "@/services/evenservices";
import { emptyEventForm, EventForm as EventFormValues, formToTickets } from "@/utils/validate-event";

export default function NewEventScreen() {
  const { user } = useAuth();

  async function handleCreate(form: EventFormValues) {
    const { tickets, ...eventData } = form;
    const event = await createEvent(
      // Le collectif vient de l'organisateur connecté, jamais du formulaire.
      { ...eventData, collectiveId: user?.collectiveId ?? "" },
      formToTickets(tickets)
    );
    // replace (et pas push) : un retour arrière depuis le détail ne revient pas sur le formulaire.
    router.replace({ pathname: "/organizer/event/[id]", params: { id: event.id } });
  }

  return (
    <EventForm
      initialValues={emptyEventForm}
      // À la création : brouillon ou directement en vente.
      statusOptions={["draft", "on_sale"]}
      submitLabel="Créer l'événement"
      onSubmit={handleCreate}
    />
  );
}
