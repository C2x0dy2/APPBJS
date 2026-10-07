import { Stack } from "expo-router";

// Espace ACHETEUR : les onglets, et le détail d'un événement qui s'empile par-dessus.
export default function BuyerLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="event/[id]" options={{ title: "Événement" }} />
    </Stack>
  );
}
