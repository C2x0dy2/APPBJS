import { Stack } from "expo-router";

// Espace ACHETEUR : les onglets, et les pages qui s'empilent par-dessus (détail d'un événement, d'un billet).
// Chaque page dessine son propre en-tête (bouton retour sur la pochette) : pas de barre de titre native.
export default function BuyerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="event/[id]" />
      <Stack.Screen name="ticket/[id]" />
    </Stack>
  );
}
