import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { EventCard } from "@/components/event-card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen, ScreenHeader } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { ContentWidth } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useLoad } from "@/hooks/use-load";
import { getCollectiveEvents } from "@/services/organizerservices";
import { Event } from "@/types/even";
import { sortUpcomingFirst } from "@/utils/events";
import { chunk } from "@/utils/list";

type Filter = "all" | "on_sale" | "draft" | "finished";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "on_sale", label: "En vente" },
  { value: "draft", label: "Brouillons" },
  { value: "finished", label: "Terminés" },
];

function matchesFilter(event: Event, filter: Filter): boolean {
  if (filter === "on_sale") return event.status === "on_sale" || event.status === "sold_out";
  if (filter === "draft") return event.status === "draft";
  if (filter === "finished") return event.status === "finished" || event.status === "canceled";
  return true;
}

// Organisateur : TOUS les événements de SON collectif, brouillons et annulés compris.
export default function OrganizerEventsScreen() {
  const { collectiveId } = useAuth();
  const { columns } = useBreakpoint();
  const [filter, setFilter] = useState<Filter>("all");

  // Les événements du collectif actif, relus à chaque retour sur l'écran : on voit tout de suite une création ou une modification.
  const load = useCallback(() => getCollectiveEvents(collectiveId), [collectiveId]);
  const { data, error, loading, reload } = useLoad(load);
  const events = data ?? [];
  const loaded = data !== undefined;

  // Les événements à venir d'abord (le plus proche en premier), les passés ensuite.
  const shown = sortUpcomingFirst(events.filter((event) => matchesFilter(event, filter)));
  const rows = chunk(shown, columns);

  return (
    <Screen maxWidth={ContentWidth.wide}>
      <ScreenHeader
        title="Mes événements"
        subtitle={loaded ? `${events.length} événement${events.length > 1 ? "s" : ""}` : undefined}
        right={<Button title="Créer" icon="plus" size="sm" fullWidth={false} onPress={() => router.push("/organizer/event/new")} />}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((item) => (
          <Chip key={item.value} label={item.label} selected={filter === item.value} onPress={() => setFilter(item.value)} />
        ))}
      </ScrollView>

      {loading && <LoadingState />}
      {data === undefined && error ? <ErrorState error={error} onRetry={reload} /> : null}

      {rows.map((row) => (
        <View key={row.map((event) => event.id).join("-")} style={styles.row}>
          {row.map((event) => (
            <View key={event.id} style={styles.cell}>
              <EventCard event={event} href={{ pathname: "/organizer/event/[id]", params: { id: event.id } }} />
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, index) => (
            <View key={`empty-${index}`} style={styles.cell} />
          ))}
        </View>
      ))}

      {loaded && shown.length === 0 &&
        (events.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="Aucun événement"
            message="Crée le premier événement de ton collectif."
            actionLabel="Créer un événement"
            onAction={() => router.push("/organizer/event/new")}
          />
        ) : (
          <EmptyState icon="list" title="Aucun événement dans cette catégorie" actionLabel="Tout afficher" onAction={() => setFilter("all")} />
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    gap: 8,
    paddingBottom: 18,
  },

  row: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },

  cell: {
    flex: 1,
  },
});
