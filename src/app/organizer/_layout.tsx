import { Stack } from "expo-router";

// Espace ORGANISATEUR : toutes ses adresses commencent par /organizer.
// (Un dossier sans parenthèses ajoute son nom dans l'adresse, contrairement à "(buyer)".)
export default function OrganizerLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event/[id]" options={{ title: "Événement" }} />
      <Stack.Screen name="event/new" options={{ title: "Nouvel événement" }} />
      <Stack.Screen name="event/edit/[id]" options={{ title: "Modifier l'événement" }} />
    </Stack>
  );
}
