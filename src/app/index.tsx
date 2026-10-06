import { StyleSheet, Text, View, Pressable } from "react-native";
import { events } from "../constants/events";

export default function HomeScreen() {
  const event = events[0];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Billetterie</Text>

      <View style={styles.card}>
        <Text style={styles.eventName}>{event.name}</Text>

        <Text style={styles.info}>📍 {event.location}</Text>
        <Text style={styles.info}>📅 {event.date}</Text>
        <Text style={styles.info}>🕐 {event.startTime}</Text>

        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>Voir les billets</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 80,
    backgroundColor: "#fff",
  },

  title: {
    fontSize: 30,
    fontWeight: "bold",
    marginBottom: 30,
  },

  card: {
    padding: 20,
    borderRadius: 15,
    backgroundColor: "#f5f5f5",
  },

  eventName: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 15,
  },

  info: {
    fontSize: 16,
    marginBottom: 8,
  },

  button: {
    marginTop: 20,
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
});