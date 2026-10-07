import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, useFocusEffect } from "expo-router";

import { EventCard } from "@/components/event-card";
import { useAuth } from "@/context/auth";
import { getCollectiveEvents } from "@/services/evenservices";
import { Event } from "@/types/even";

// Organisateur : TOUS les événements de SON collectif, brouillons et annulés compris.
export default function OrganizerEventsScreen() {
  const { user } = useAuth();
  const collectiveId = user?.collectiveId ?? "";
  const [events, setEvents] = useState<Event[]>([]);

  // Rechargé à chaque retour sur l'écran : on voit tout de suite une création ou une modification.
  useFocusEffect(
    useCallback(() => {
      getCollectiveEvents(collectiveId).then(setEvents);
    }, [collectiveId])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Mes événements</Text>
        <Link href="/organizer/event/new" asChild>
          <Pressable style={styles.createButton}>
            <Text style={styles.createButtonText}>+ Créer</Text>
          </Pressable>
        </Link>
      </View>

      <FlatList
        data={events}
        keyExtractor={(event) => event.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <EventCard event={item} href={{ pathname: "/organizer/event/[id]", params: { id: item.id } }} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aucun événement. Crée le premier !</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 80,
    backgroundColor: "#fff",
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 20,
  },

  title: {
    fontSize: 28,
    fontWeight: "bold",
  },

  createButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#000",
  },

  createButtonText: {
    color: "#fff",
    fontWeight: "bold",
  },

  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 15,
  },

  empty: {
    fontSize: 16,
    color: "#666",
  },
});
