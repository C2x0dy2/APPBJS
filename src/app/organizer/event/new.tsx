import { router } from "expo-router";

import { EventForm } from "@/components/event-form";
import { useAuth } from "@/context/auth";
import { useSite } from "@/context/site";
import { createEvent } from "@/services/organizerservices";
import { emptyEventForm, EventForm as EventFormValues, formToInput } from "@/utils/validate-event";

export default function NewEventScreen() {
  const { collectiveId } = useAuth();
  const site = useSite();

  async function handleCreate(form: EventFormValues) {
    // Le collectif est celui sur lequel l'organisateur travaille, jamais celui du formulaire : le serveur vérifie qu'il en fait partie.
    if (!collectiveId) throw new Error("Aucun collectif n'est associé à ton compte.");
    const event = await createEvent(collectiveId, formToInput(form));
    // replace (et pas push) : un retour arrière depuis le détail ne revient pas sur le formulaire.
    router.replace({ pathname: "/organizer/event/[id]", params: { id: event.id } });
  }

  return (
    <EventForm
      // La monnaie et le fuseau proposés viennent du serveur : le formulaire repart si ces réglages arrivent après son affichage.
      key={site ? "site-loaded" : "site-pending"}
      initialValues={emptyEventForm(site)}
      // À la création : brouillon ou directement en vente.
      statusOptions={["draft", "on_sale"]}
      submitLabel="Créer l'événement"
      onSubmit={handleCreate}
    />
  );
}
