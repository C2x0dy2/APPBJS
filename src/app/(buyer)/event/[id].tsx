import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { EventInfo } from "@/components/event-info";
import { getEventById, getTicketTypes } from "@/services/evenservices";
import { Event } from "@/types/even";
import { TicketType } from "@/types/ticket";

// Détail côté ACHETEUR : lecture seule. Le bouton "Réserver" viendra avec la partie de Diaby.
export default function BuyerEventScreen() {
  // Récupère le [id] de l'URL : /event/event-1 -> id = "event-1".
  const { id } = useLocalSearchParams<{ id: string }>();

  // undefined = pas encore chargé, null = introuvable.
  const [event, setEvent] = useState<Event | null>();
  const [tickets, setTickets] = useState<TicketType[]>([]);

  useEffect(() => {
    getEventById(id).then((found) => {
      // Un brouillon ou un événement annulé n'est pas visible par le public,
      // même si quelqu'un tape son adresse à la main.
      const isPublic = found && (found.status === "on_sale" || found.status === "sold_out");
      setEvent(isPublic ? found : null);
    });
    getTicketTypes(id).then(setTickets);
  }, [id]);

  if (event === undefined) return <Text style={styles.message}>Chargement…</Text>;
  if (event === null) return <Text style={styles.message}>Événement introuvable.</Text>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <EventInfo event={event} tickets={tickets} />
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
  },
});
