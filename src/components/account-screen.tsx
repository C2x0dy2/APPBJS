import { Pressable, StyleSheet, Text, View } from "react-native";

import { collectives } from "@/constants/events";
import { useAuth } from "@/context/auth";

// Onglet "Compte", identique dans les deux espaces.
export function AccountScreen() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  const collective = collectives.find((c) => c.id === user.collectiveId);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mon compte</Text>

      <View style={styles.card}>
        <Text style={styles.name}>{user.name}</Text>
        <Text style={styles.info}>{user.role === "buyer" ? "Acheteur" : "Organisateur"}</Text>
        {collective && <Text style={styles.info}>{collective.name}</Text>}
      </View>

      {/* signOut met "user" à null : le layout racine renvoie vers l'écran de connexion. */}
      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Se déconnecter</Text>
      </Pressable>
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

  card: {
    padding: 20,
    borderRadius: 15,
    backgroundColor: "#f5f5f5",
    marginBottom: 20,
  },

  name: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 6,
  },

  info: {
    fontSize: 16,
    color: "#666",
    marginTop: 2,
  },

  button: {
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c62828",
  },

  buttonText: {
    color: "#c62828",
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
  },
});
