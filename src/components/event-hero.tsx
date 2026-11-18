import { router } from "expo-router";
import { Platform, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EventCover } from "@/components/event-cover";
import { Icon } from "@/components/ui/icon";
import { Event } from "@/types/even";

// La grande pochette en haut d'un détail d'événement, avec le bouton retour.
// Le contenu de l'écran remonte par-dessus avec une marge négative (voir "sheet" dans les écrans).
export function EventHero({ event, height = 200 }: { event: Pick<Event, "id" | "image">; height?: number }) {
  const insets = useSafeAreaInsets();
  const top = (Platform.OS === "web" ? 0 : insets.top) + 12;

  function goBack() {
    // Arrivé par un lien direct, il n'y a pas d'écran précédent : on retourne à l'accueil.
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <EventCover event={event} height={height + (Platform.OS === "web" ? 0 : insets.top)}>
      <Pressable
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel="Retour"
        hitSlop={8}
        style={({ pressed }) => [styles.back, { top }, pressed && { opacity: 0.8 }]}>
        <Icon name="back" size={22} color="#1D0B33" />
      </Pressable>
    </EventCover>
  );
}

const styles = StyleSheet.create({
  back: {
    position: "absolute",
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    boxShadow: "0 2px 8px rgba(18, 4, 31, 0.2)",
  },
});
