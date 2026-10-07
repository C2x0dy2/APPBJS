import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { EventInfo } from "@/components/event-info";
import { useAuth } from "@/context/auth";
import { cancelEvent, deleteEvent, getEventById, getTicketTypes } from "@/services/evenservices";
import { Event } from "@/types/even";
import { TicketType } from "@/types/ticket";
import { confirmAction } from "@/utils/confirm";

// Détail côté ORGANISATEUR : mêmes infos que l'acheteur + les actions de gestion.
export default function OrganizerEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [event, setEvent] = useState<Event | null>(); // undefined = chargement, null = introuvable
  const [tickets, setTickets] = useState<TicketType[]>([]);

  // useCallback : "load" reste la même fonction tant que id et le collectif ne changent pas.
  const load = useCallback(() => {
    getEventById(id).then((found) => {
      // Cloisonnement : l'événement d'un autre collectif est traité comme introuvable.
      const isMine = found && found.collectiveId === user?.collectiveId;
      // { ...found } : nouvelle copie, pour que React voie le changement après une modification.
      setEvent(isMine ? { ...found } : null);
    });
    getTicketTypes(id).then(setTickets);
  }, [id, user?.collectiveId]);

  // Rechargé à chaque retour sur l'écran, par exemple après "Modifier".
  useFocusEffect(load);

  async function handleCancel() {
    const ok = await confirmAction(
      "Annuler l'événement ?",
      "Il ne sera plus visible par les acheteurs. Cette action est définitive.",
      "Annuler l'événement"
    );
    if (!ok) return;
    await cancelEvent(id);
    load();
  }

  async function handleDelete() {
    const ok = await confirmAction(
      "Supprimer le brouillon ?",
      "L'événement et ses types de places seront effacés.",
      "Supprimer"
    );
    if (!ok) return;
    await deleteEvent(id);
    router.back();
  }

  if (event === undefined) return <Text style={styles.message}>Chargement…</Text>;
  if (event === null) return <Text style={styles.message}>Événement introuvable.</Text>;

  // Quelles actions selon le statut :
  //   brouillon         -> Modifier, Supprimer (rien n'a été vendu)
  //   en vente / complet -> Modifier, Annuler
  //   terminé / annulé  -> plus aucune action
  const canEdit = event.status === "draft" || event.status === "on_sale" || event.status === "sold_out";
  const canDelete = event.status === "draft";
  const canCancel = event.status === "on_sale" || event.status === "sold_out";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <EventInfo event={event} tickets={tickets} />

      <View style={styles.actions}>
        {canEdit && (
          <Link href={{ pathname: "/organizer/event/edit/[id]", params: { id: event.id } }} asChild>
            <Pressable style={styles.button}>
              <Text style={styles.buttonText}>Modifier</Text>
            </Pressable>
          </Link>
        )}

        {canDelete && (
          <Pressable style={styles.dangerButton} onPress={handleDelete}>
            <Text style={styles.dangerButtonText}>Supprimer le brouillon</Text>
          </Pressable>
        )}

        {canCancel && (
          <Pressable style={styles.dangerButton} onPress={handleCancel}>
            <Text style={styles.dangerButtonText}>Annuler l’événement</Text>
          </Pressable>
        )}

        {!canEdit && <Text style={styles.message}>Cet événement ne peut plus être modifié.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  content: {
    padding: 20,
    paddingBottom: 40,
  },

  message: {
    padding: 20,
    fontSize: 16,
    color: "#666",
  },

  actions: {
    marginTop: 20,
    gap: 12,
  },

  button: {
    padding: 15,
    borderRadius: 10,
    backgroundColor: "#000",
  },

  buttonText: {
    color: "#fff",
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
  },

  dangerButton: {
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c62828",
  },

  dangerButtonText: {
    color: "#c62828",
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
  },
});
