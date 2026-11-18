import { router, usePathname } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Icon, IconName } from "@/components/ui/icon";
import { useTheme } from "@/hooks/use-theme";

type SignInPromptProps = {
  icon: IconName;
  title: string;
  message: string;
};

// Ce que voit un visiteur sur un écran réservé aux comptes : pourquoi, et deux boutons pour continuer.
// Après la connexion, il revient automatiquement sur l'écran où il se trouvait.
export function SignInPrompt({ icon, title, message }: SignInPromptProps) {
  const theme = useTheme();
  const pathname = usePathname();
  const params = { redirect: pathname };

  return (
    <View style={styles.container}>
      <View style={[styles.circle, { backgroundColor: theme.primarySoft }]}>
        <Icon name={icon} size={36} color="primary" />
      </View>
      <AppText variant="h2" style={styles.title}>
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" style={styles.message}>
        {message}
      </AppText>

      <View style={styles.buttons}>
        <Button title="Se connecter" icon="login" onPress={() => router.push({ pathname: "/login", params })} />
        <Button title="Créer un compte" variant="secondary" onPress={() => router.push({ pathname: "/register", params })} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: 24,
  },
  circle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    marginTop: 8,
    maxWidth: 340,
  },
  buttons: {
    alignSelf: "stretch",
    maxWidth: 360,
    width: "100%",
    gap: 12,
    marginTop: 28,
  },
});
