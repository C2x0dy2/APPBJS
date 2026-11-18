import { Stack } from "expo-router";

import { useTheme } from "@/hooks/use-theme";

// Espace ORGANISATEUR : toutes ses adresses commencent par /organizer.
// (Un dossier sans parenthèses ajoute son nom dans l'adresse, contrairement à "(buyer)".)
// Le détail d'un événement dessine son propre en-tête ; les formulaires gardent la barre de titre native.
export default function OrganizerLayout() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.primary,
        headerTitleStyle: { color: theme.text },
        headerStyle: { backgroundColor: theme.surface },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="event/new" options={{ title: "Nouvel événement" }} />
      <Stack.Screen name="event/edit/[id]" options={{ title: "Modifier l'événement" }} />
    </Stack>
  );
}
