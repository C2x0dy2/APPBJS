import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";

import { EventForm } from "@/components/event-form";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { LoadBoundary } from "@/components/ui/state";
import { useLoad } from "@/hooks/use-load";
import { getOrganizerEvent, getOrganizerTicketTypes, updateEvent } from "@/services/organizerservices";
import { EditableStatus, eventToForm, EventForm as EventFormValues, formToInput } from "@/utils/validate-event";

type EditData = { initialValues: EventFormValues; statusOptions: EditableStatus[] } | null; // null : impossible à modifier

export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // Le serveur répond « introuvable » pour l'événement d'un autre collectif (cloisonnement).
  const load = useCallback(async (): Promise<EditData> => {
    const [event, tickets] = await Promise.all([getOrganizerEvent(id), getOrganizerTicketTypes(id)]);
    if (!event || event.status === "finished" || event.status === "canceled") return null;
    return {
      initialValues: eventToForm(event, tickets),
      // Un brouillon peut passer en vente. Une fois en vente, on ne revient plus en brouillon :
      // des places ont pu être réservées. L'annulation, elle, a son propre bouton sur le détail.
      statusOptions: event.status === "draft" ? ["draft", "on_sale"] : ["on_sale"],
    };
  }, [id]);
  const state = useLoad(load);

  async function handleSave(form: EventFormValues) {
    await updateEvent(id, formToInput(form));
    // Arrivé par un lien direct, il n'y a pas d'écran précédent : on ouvre le détail de l'événement.
    if (router.canGoBack()) router.back(); // retour au détail, qui se recharge tout seul
    else router.replace({ pathname: "/organizer/event/[id]", params: { id } });
  }

  return (
    <LoadBoundary state={state}>
      {(data) =>
        data === null ? (
          <Screen topInset={false}>
            <EmptyState
              icon="edit"
              title="Modification impossible"
              message="Cet événement n'existe pas, est terminé ou annulé, ou appartient à un autre collectif."
              actionLabel="Retour"
              onAction={() => (router.canGoBack() ? router.back() : router.replace("/organizer"))}
            />
          </Screen>
        ) : (
          // On n'affiche le formulaire qu'une fois les données chargées :
          // EventForm ne lit initialValues qu'au premier affichage.
          <EventForm initialValues={data.initialValues} statusOptions={data.statusOptions} submitLabel="Enregistrer les modifications" onSubmit={handleSave} />
        )
      }
    </LoadBoundary>
  );
}
