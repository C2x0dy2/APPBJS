import { StyleSheet, Text, View } from "react-native";

import { StatusBadge } from "./event-card";
import { currentPrice } from "../services/evenservices";
import { Event } from "../types/even";
import { TicketType } from "../types/ticket";
import { formatDate, formatPrice } from "../utils/format";

// Le contenu du détail d'un événement (infos + types de places).
// Partagé par les deux espaces ; chaque écran ajoute ses propres boutons autour.
export function EventInfo({ event, tickets }: { event: Event; tickets: TicketType[] }) {
  return (
    <View>
      <Text style={styles.title}>{event.name}</Text>
      <View style={styles.badgeRow}>
        <StatusBadge status={event.status} />
      </View>

      <View style={styles.card}>
        <Text style={styles.info}>📍 {event.location}</Text>
        <Text style={styles.info}>📅 {formatDate(event.date)}</Text>
        <Text style={styles.info}>🚪 Ouverture des portes : {event.doorsOpenTime}</Text>
        <Text style={styles.info}>🕐 Début : {event.startTime}</Text>
        {/* Le fuseau est toujours affiché : utile pour les participants à l'étranger. */}
        <Text style={styles.small}>Heures indiquées dans le fuseau {event.timezone}</Text>
        <Text style={styles.small}>Annulation possible jusqu’au {formatDate(event.cancellationDeadline)}</Text>
      </View>

      <Text style={styles.sectionTitle}>Types de places</Text>

      {tickets.map((ticket) => {
        const price = currentPrice(ticket);
        const isEarly = price !== ticket.price;

        return (
          <View key={ticket.id} style={styles.ticket}>
            <View style={styles.ticketLeft}>
              <Text style={styles.ticketName}>{ticket.name}</Text>
              <Text style={styles.small}>{ticket.quantity} places</Text>
              {isEarly && ticket.earlyPriceDeadline && (
                <Text style={styles.early}>Tarif early jusqu’au {formatDate(ticket.earlyPriceDeadline)}</Text>
              )}
            </View>

            <View style={styles.ticketRight}>
              <Text style={styles.price}>{formatPrice(price, event.currency)}</Text>
              {/* Prix normal barré quand le tarif early s'applique. */}
              {isEarly && <Text style={styles.oldPrice}>{formatPrice(ticket.price, event.currency)}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontWeight: "bold",
  },

  badgeRow: {
    flexDirection: "row",
    marginTop: 8,
    marginBottom: 20,
  },

  card: {
    padding: 20,
    borderRadius: 15,
    backgroundColor: "#f5f5f5",
    marginBottom: 25,
  },

  info: {
    fontSize: 16,
    marginBottom: 8,
  },

  small: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
  },

  ticket: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    marginBottom: 10,
  },

  ticketLeft: {
    flex: 1,
  },

  ticketName: {
    fontSize: 17,
    fontWeight: "bold",
  },

  early: {
    fontSize: 13,
    color: "#2e7d32",
    marginTop: 4,
  },

  ticketRight: {
    alignItems: "flex-end",
  },

  price: {
    fontSize: 18,
    fontWeight: "bold",
  },

  oldPrice: {
    fontSize: 13,
    color: "#999",
    textDecorationLine: "line-through",
  },
});
