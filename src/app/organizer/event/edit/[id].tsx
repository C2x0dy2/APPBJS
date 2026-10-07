import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { EventForm } from "@/components/event-form";
import { useAuth } from "@/context/auth";
import { getEventById, getTicketTypes, updateEvent } from "@/services/evenservices";
import { EvenStatus } from "@/types/even";
import { eventToForm, EventForm as EventFormValues, formToTickets } from "@/utils/validate-event";

export default function EditEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  // undefined = chargement, null = impossible à modifier, sinon les valeurs de départ du formulaire.
  const [initialValues, setInitialValues] = useState<EventFormValues | null>();
  const [statusOptions, setStatusOptions] = useState<EvenStatus[]>([]);

  useEffect(() => {
    Promise.all([getEventById(id), getTicketTypes(id)]).then(([event, tickets]) => {
      const editable =
        event &&
        event.collectiveId === user?.collectiveId && // cloisonnement
        event.status !== "finished" &&
        event.status !== "canceled";

      if (!editable) {
        setInitialValues(null);
        return;
      }

      // Un brouillon peut passer en vente. Une fois en vente, on ne revient plus en brouillon :
      // des places ont pu être vendues. L'annulation, elle, a son propre bouton sur le détail.
      setStatusOptions(event.status === "draft" ? ["draft", "on_sale"] : ["on_sale", "sold_out", "finished"]);
      setInitialValues(eventToForm(event, tickets));
    });
  }, [id, user?.collectiveId]);

  async function handleSave(form: EventFormValues) {
    const { tickets, ...eventData } = form;
    await updateEvent(id, eventData, formToTickets(tickets));
    router.back(); // retour au détail, qui se recharge tout seul (useFocusEffect)
  }

  if (initialValues === undefined) return <Text style={styles.message}>Chargement…</Text>;
  if (initialValues === null) return <Text style={styles.message}>Cet événement ne peut pas être modifié.</Text>;

  // On n'affiche le formulaire qu'une fois les données chargées :
  // EventForm ne lit initialValues qu'au premier affichage.
  return (
    <EventForm
      initialValues={initialValues}
      statusOptions={statusOptions}
      submitLabel="Enregistrer les modifications"
      onSubmit={handleSave}
    />
  );
}

const styles = StyleSheet.create({
  message: {
    padding: 20,
    fontSize: 16,
  },
});
