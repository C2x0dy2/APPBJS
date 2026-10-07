import { Pressable, StyleSheet, Text, View } from "react-native";
import { Href, Link } from "expo-router";

import { Event, EvenStatus } from "../types/even";
import { formatDate, statusLabels } from "../utils/format";

// Carte d'un événement dans une liste. Utilisée par les DEUX espaces :
// seul "href" change (détail acheteur ou détail organisateur).
export function EventCard({ event, href }: { event: Event; href: Href }) {
  return (
    // Link + asChild : toute la carte devient cliquable.
    <Link href={href} asChild>
      <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.cardHeader}>
          <Text style={styles.eventName}>{event.name}</Text>
          <StatusBadge status={event.status} />
        </View>

        <Text style={styles.info}>📍 {event.location}</Text>
        <Text style={styles.info}>📅 {formatDate(event.date)}</Text>
        <Text style={styles.info}>🕐 {event.startTime}</Text>
      </Pressable>
    </Link>
  );
}

export function StatusBadge({ status }: { status: EvenStatus }) {
  return (
    <View style={[styles.badge, { backgroundColor: statusColors[status] }]}>
      <Text style={styles.badgeText}>{statusLabels[status]}</Text>
    </View>
  );
}

const statusColors: Record<EvenStatus, string> = {
  draft: "#9e9e9e",
  on_sale: "#2e7d32",
  sold_out: "#c62828",
  finished: "#455a64",
  canceled: "#6d4c41",
};

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 15,
    backgroundColor: "#f5f5f5",
  },

  pressed: {
    opacity: 0.7,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },

  eventName: {
    flex: 1,
    fontSize: 20,
    fontWeight: "bold",
  },

  info: {
    fontSize: 16,
    marginBottom: 6,
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },

  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
});
