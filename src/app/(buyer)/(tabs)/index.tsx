import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { AppBar } from "@/components/app-bar";
import { EventCard, FeaturedEventCard } from "@/components/event-card";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { AppText } from "@/components/ui/app-text";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Screen, SCREEN_PADDING, SectionHeader } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { BRAND } from "@/constants/brand";
import { ContentWidth, Gradients, Radius } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useLoad } from "@/hooks/use-load";
import { useTheme } from "@/hooks/use-theme";
import { getPublicEvents } from "@/services/evenservices";
import { Event } from "@/types/even";
import { daysUntil, toISODate } from "@/utils/format";
import { chunk, normalizeText } from "@/utils/list";

type Filter = "all" | "week" | "month" | "available";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois-ci" },
  { value: "available", label: "Places disponibles" },
];

function matchesFilter(event: Event, filter: Filter): boolean {
  if (filter === "week") return daysUntil(event.date) >= 0 && daysUntil(event.date) <= 7;
  // "Ce mois-ci" : même mois et même année que aujourd'hui ("2026-11" = les 7 premiers caractères de la date).
  if (filter === "month") return event.date.slice(0, 7) === toISODate(new Date()).slice(0, 7);
  if (filter === "available") return event.status === "on_sale";
  return true;
}

// Accueil : ouvert à tout le monde, avec ou sans compte. Les événements visibles du public
// (en vente ou complets), tous collectifs confondus.
export default function HomeScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { columns, isWide } = useBreakpoint();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Les événements viennent du serveur, relus à chaque retour sur l'écran.
  const load = useCallback(() => getPublicEvents(), []);
  const { data, error, loading, reload } = useLoad(load);
  const events = data ?? [];

  const search = normalizeText(query.trim());
  const filtering = search !== "" || filter !== "all";
  const visible = events
    .filter((event) => matchesFilter(event, filter))
    .filter((event) => search === "" || normalizeText(`${event.name} ${event.location}`).includes(search))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Sans recherche ni filtre, le prochain événement est mis en avant ; la grille montre les suivants.
  const featured = !filtering ? visible[0] : undefined;
  const rows = chunk(featured ? visible.slice(1) : visible, columns);

  function reset() {
    setQuery("");
    setFilter("all");
  }

  const header = (
    <View>
      {/* Sur ordinateur, le logo et la connexion sont déjà dans la barre du haut. */}
      {!isWide && <AppBar />}

      <VerifyEmailBanner style={styles.verifyBanner} />

      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={[styles.heroCircle, styles.heroCircleTop]} />
        <View style={[styles.heroCircle, styles.heroCircleBottom]} />

        <AppText variant="eyebrow" color="rgba(255, 255, 255, 0.85)">
          {user ? `Bonjour ${user.name}` : `Bienvenue sur ${BRAND.name}`}
        </AppText>
        <AppText variant="display" color="#FFFFFF" style={styles.heroTitle}>
          {BRAND.tagline}
        </AppText>

        <View style={[styles.search, { backgroundColor: theme.surface }]}>
          <Icon name="search" size={20} color="textSecondary" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Événement, lieu…"
            placeholderTextColor={theme.textTertiary}
            accessibilityLabel="Rechercher un événement"
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query !== "" && (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Effacer la recherche">
              <Icon name="close" size={18} color="textSecondary" />
            </Pressable>
          )}
        </View>
      </LinearGradient>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        {FILTERS.map((item) => (
          <Chip key={item.value} label={item.label} selected={filter === item.value} onPress={() => setFilter(item.value)} />
        ))}
      </ScrollView>

      {featured && (
        <View style={styles.featured}>
          <FeaturedEventCard
            event={featured}
            href={{ pathname: "/event/[id]", params: { id: featured.id } }}
          />
        </View>
      )}

      {rows.length > 0 && (
        <SectionHeader
          title={filtering ? "Résultats" : "À venir"}
          actionLabel={filtering ? "Tout afficher" : undefined}
          onAction={filtering ? reset : undefined}
        />
      )}
    </View>
  );

  return (
    <Screen scroll={false} maxWidth={ContentWidth.wide}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.map((event) => event.id).join("-")}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((event) => (
              <View key={event.id} style={styles.cell}>
                <EventCard event={event} href={{ pathname: "/event/[id]", params: { id: event.id } }} />
              </View>
            ))}
            {/* Des cases vides complètent la dernière ligne : les cartes gardent toutes la même largeur. */}
            {Array.from({ length: columns - row.length }, (_, index) => (
              <View key={`empty-${index}`} style={styles.cell} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <LoadingState />
          ) : data === undefined && error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !featured ? (
            filtering ? (
              <EmptyState
                icon="search"
                title="Aucun résultat"
                message="Aucun événement ne correspond à ta recherche."
                actionLabel="Réinitialiser"
                onAction={reset}
              />
            ) : (
              <EmptyState icon="calendar" title="Aucun événement en vente" message="Reviens bientôt : les prochains événements apparaîtront ici." />
            )
          ) : null
        }
        ListFooterComponent={<View style={styles.footerSpace} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 12,
  },

  verifyBanner: {
    marginBottom: 16,
  },

  hero: {
    borderRadius: Radius.xl,
    padding: 24,
    gap: 8,
    overflow: "hidden",
  },

  heroTitle: {
    marginBottom: 12,
  },

  heroCircle: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },

  heroCircleTop: {
    width: 220,
    height: 220,
    right: -70,
    top: -90,
  },

  heroCircleBottom: {
    width: 300,
    height: 300,
    left: -120,
    bottom: -170,
  },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    boxShadow: "0 6px 18px rgba(18, 4, 31, 0.22)",
  },

  searchInput: {
    flex: 1,
    height: "100%",
    fontSize: 16,
    outlineWidth: 0,
  },

  chips: {
    gap: 8,
    paddingVertical: 18,
  },

  featured: {
    marginBottom: 8,
  },

  row: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },

  cell: {
    flex: 1,
  },

  footerSpace: {
    height: 24,
  },
});
