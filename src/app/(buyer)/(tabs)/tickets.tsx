import { StyleSheet, Text, View } from "react-native";

// Écran réservé : les billets viendront du système de réservation (partie de Diaby).
export default function TicketsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mes billets</Text>
      <Text style={styles.empty}>Tes billets apparaîtront ici après un achat.</Text>
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
    marginBottom: 20,
  },

  empty: {
    fontSize: 16,
    color: "#666",
  },
});
