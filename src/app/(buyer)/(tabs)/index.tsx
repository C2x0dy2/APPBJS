import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { EventCard } from "@/components/event-card";
import { getPublicEvents } from "@/services/evenservices";
import { Event } from "@/types/even";

// Acheteur : les événements visibles du public (en vente ou complets), tous collectifs confondus.
export default function BuyerEventsScreen() {
  const [events, setEvents] = useState<Event[]>([]);

  // useFocusEffect : on recharge à chaque retour sur l'écran.
  useFocusEffect(
    useCallback(() => {
      getPublicEvents().then(setEvents);
    }, [])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Événements</Text>

      {/* FlatList n'affiche que les cartes visibles : reste fluide même avec beaucoup d'événements. */}
      <FlatList
        data={events}
        keyExtractor={(event) => event.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <EventCard event={item} href={{ pathname: "/event/[id]", params: { id: item.id } }} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aucun événement en vente pour le moment.</Text>}
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

  title: {
    fontSize: 30,
    fontWeight: "bold",
    marginBottom: 20,
    paddingHorizontal: 20,
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
