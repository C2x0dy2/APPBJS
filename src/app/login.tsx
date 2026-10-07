import { Pressable, StyleSheet, Text, View } from "react-native";

import { Role, useAuth } from "@/context/auth";

// Connexion fictive : on choisit son espace. Sera remplacé par email + mot de passe.
export default function LoginScreen() {
  const { signIn } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Billetterie</Text>
      <Text style={styles.subtitle}>Concerts et soirées à Bordeaux</Text>

      <RoleButton
        role="buyer"
        title="Je suis acheteur"
        description="Voir les événements et mes billets"
        onPress={signIn}
      />
      <RoleButton
        role="organizer"
        title="Je suis organisateur"
        description="Gérer les événements de mon collectif"
        onPress={signIn}
      />

      <Text style={styles.note}>Connexion de démonstration, sans mot de passe.</Text>
    </View>
  );
}

// Pas besoin de naviguer à la main après signIn : le layout racine voit que "user" a changé
// et ouvre automatiquement le bon espace (grâce aux Stack.Protected).
function RoleButton({ role, title, description, onPress }: {
  role: Role;
  title: string;
  description: string;
  onPress: (role: Role) => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={() => onPress(role)}
    >
      <Text style={styles.buttonTitle}>{title}</Text>
      <Text style={styles.buttonDescription}>{description}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fff",
  },

  title: {
    fontSize: 34,
    fontWeight: "bold",
    textAlign: "center",
  },

  subtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 40,
  },

  button: {
    padding: 20,
    borderRadius: 15,
    backgroundColor: "#000",
    marginBottom: 14,
  },

  pressed: {
    opacity: 0.7,
  },

  buttonTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },

  buttonDescription: {
    color: "#ccc",
    fontSize: 14,
    marginTop: 4,
  },

  note: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    marginTop: 20,
  },
});
