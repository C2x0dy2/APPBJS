import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { useAuth } from "@/context/auth";

// La barre du haut des écrans d'accueil : le logo à gauche, et à droite
// soit les boutons de connexion (visiteur), soit l'avatar (personne connectée).
export function AppBar() {
  const { user } = useAuth();

  return (
    <View style={styles.bar}>
      <Logo size={34} />

      {user ? (
        <Pressable onPress={() => router.push(user.role === "organizer" ? "/organizer/account" : "/account")} accessibilityRole="button" accessibilityLabel="Mon compte">
          <Avatar name={user.name} size={38} />
        </Pressable>
      ) : (
        <View style={styles.actions}>
          <Button title="Connexion" variant="ghost" size="sm" fullWidth={false} onPress={() => router.push("/login")} />
          <Button title="S'inscrire" size="sm" fullWidth={false} onPress={() => router.push("/register")} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },

  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});
