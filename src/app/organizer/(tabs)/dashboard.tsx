import { StyleSheet, Text, View } from "react-native";

// Étape 6 du plan : on le construira quand les réservations (partie de Diaby) existeront.
export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tableau de bord</Text>
      <Text style={styles.empty}>
        Bientôt : places vendues, retenues et libres, liste d’attente, argent encaissé,
        remboursements, ventes par jour et entrées le jour J.
      </Text>
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
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
  },

  empty: {
    fontSize: 16,
    color: "#666",
    lineHeight: 24,
  },
});
