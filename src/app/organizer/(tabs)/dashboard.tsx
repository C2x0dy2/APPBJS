import { useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { BarChart } from "@/components/bar-chart";
import { StatusBadge } from "@/components/event-card";
import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Screen, ScreenHeader, SectionHeader } from "@/components/ui/screen";
import { StatTile } from "@/components/ui/stat-tile";
import { ErrorState, LoadBoundary, LoadingState } from "@/components/ui/state";
import { ContentWidth } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useLoad } from "@/hooks/use-load";
import { useTheme } from "@/hooks/use-theme";
import { getCollectiveEvents, getCollectiveSummary, getEventStats } from "@/services/organizerservices";
import { EventStats } from "@/types/organizer";
import { sortUpcomingFirst } from "@/utils/events";
import { daysUntil, formatDateShort, formatNumber, formatPercent, formatPrice } from "@/utils/format";

// Tableau de bord ORGANISATEUR : les ventes de son collectif, événement par événement.
export default function OrganizerDashboardScreen() {
  const { user, collectiveId } = useAuth();
  // Arrivé depuis le détail d'un événement : on affiche directement cet événement.
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const [choice, setChoice] = useState<{ param?: string; id: string }>();

  // Le total par monnaie et les événements du collectif (sans les brouillons : rien n'a pu être vendu).
  // Les événements annulés restent : c'est là que l'organisateur voit ce qu'il doit rembourser.
  const loadOverview = useCallback(async () => {
    const [list, summary] = await Promise.all([getCollectiveEvents(collectiveId), getCollectiveSummary(collectiveId)]);
    return { events: sortUpcomingFirst(list.filter((event) => event.status !== "draft")), summary };
  }, [collectiveId]);
  const overview = useLoad(loadOverview);

  const events = overview.data?.events ?? [];
  // Un choix fait pour une autre demande (un autre `eventId` reçu) ne compte plus.
  const wanted = choice && choice.param === eventId ? choice.id : eventId;
  const selectedId = (events.find((event) => event.id === wanted) ?? events.find((event) => event.status === "on_sale") ?? events[0])?.id;

  const loadStats = useCallback(() => getEventStats(selectedId ?? ""), [selectedId]);
  const stats = useLoad(loadStats, selectedId !== undefined);

  const collective = user?.collectives.find((item) => item.id === collectiveId);
  const summary = overview.data?.summary ?? [];
  const totalSold = summary.reduce((sum, item) => sum + item.sold, 0);

  return (
    <Screen maxWidth={ContentWidth.wide}>
      <ScreenHeader title="Tableau de bord" subtitle={collective?.name} />

      {overview.loading && <LoadingState />}
      {overview.data === undefined && overview.error ? <ErrorState error={overview.error} onRetry={overview.reload} /> : null}

      {overview.data !== undefined &&
        (events.length === 0 ? (
          <EmptyState
            icon="chart"
            title="Pas encore de ventes"
            message="Dès qu'un événement sera en vente, ses chiffres s'afficheront ici."
          />
        ) : (
          <>
            {/* Vue d'ensemble : on ne mélange jamais deux devises dans un même total. */}
            <View style={styles.tiles}>
              {summary.map((item) => (
                <StatTile
                  key={item.currency}
                  icon="money"
                  label={`Argent encaissé (${item.currency})`}
                  value={formatPrice(item.revenue, item.currency)}
                  tone="success"
                />
              ))}
              <StatTile icon="ticket" label="Billets vendus (tous événements)" value={formatNumber(totalSold)} tone="brand" />
              {summary
                .filter((item) => item.refunds.count > 0)
                .map((item) => (
                  <StatTile
                    key={`refund-${item.currency}`}
                    icon="undo"
                    label={`À rembourser (${item.currency})`}
                    value={formatPrice(item.refunds.amount, item.currency)}
                    tone="danger"
                    hint={`${item.refunds.count} paiement${item.refunds.count > 1 ? "s" : ""}`}
                  />
                ))}
            </View>

            <SectionHeader title="Par événement" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {events.map((event) => (
                <Chip key={event.id} label={event.name} selected={event.id === selectedId} onPress={() => setChoice({ param: eventId, id: event.id })} />
              ))}
            </ScrollView>

            <LoadBoundary state={stats}>{(data) => (data === null ? null : <EventDetails stats={data} />)}</LoadBoundary>
          </>
        ))}
    </Screen>
  );
}

function EventDetails({ stats: data }: { stats: EventStats }) {
  const theme = useTheme();
  const { event, totals, types, refunds, daily } = data;
  const currency = event.currency;
  const eventDay = daysUntil(event.date);
  const dailyTotal = daily.reduce((sum, point) => sum + point.tickets, 0);
  // Les entrées ne se scannent que le jour J : avant, la rubrique explique pourquoi elle est vide.
  const doorsOpen = eventDay <= 0;

  return (
    <View style={styles.details}>
      <View style={styles.eventHeader}>
        <View style={styles.eventHeaderText}>
          <AppText variant="h2" numberOfLines={2}>
            {event.name}
          </AppText>
          <AppText variant="small" color="textSecondary">
            {formatDateShort(event.date)} · {event.location}
          </AppText>
        </View>
        <StatusBadge status={event.status} />
      </View>

      {event.status === "canceled" && (
        <Banner tone="warning" title="Événement annulé" style={styles.banner}>
          Les billets sont annulés et plus rien ne se vend. L’argent déjà reçu n’est plus du chiffre d’affaires : il est à rembourser aux acheteurs.
        </Banner>
      )}

      <View style={styles.tiles}>
        <StatTile
          icon="money"
          label="Argent encaissé"
          value={formatPrice(totals.revenue, currency)}
          tone="success"
          hint={refunds.count > 0 ? `sans les ${formatPrice(refunds.amount, currency)} à rembourser` : undefined}
        />
        <StatTile icon="ticket" label="Places vendues" value={`${formatNumber(totals.sold)} / ${formatNumber(totals.capacity)}`} tone="brand" hint={`${formatPercent(totals.fillRate)} de remplissage`} />
        <StatTile icon="hourglass" label="Retenues (non payées)" value={formatNumber(totals.held)} tone="warning" />
        <StatTile icon="check" label="Places libres" value={formatNumber(totals.free)} tone="info" />
      </View>

      <View style={styles.tiles}>
        <StatTile
          icon="undo"
          label="À rembourser"
          value={formatPrice(refunds.amount, currency)}
          tone="danger"
          hint={`${refunds.count} paiement${refunds.count > 1 ? "s" : ""}`}
        />
      </View>

      {/* Ventes par jour */}
      <SectionHeader title="Ventes sur 14 jours" />
      <Card padding={16}>
        <View style={styles.chartHeader}>
          <AppText variant="h2">{formatNumber(dailyTotal)}</AppText>
          <AppText variant="small" color="textSecondary">
            billets vendus
          </AppText>
        </View>
        <BarChart
          data={daily.map((point) => ({ label: String(new Date(`${point.date}T12:00:00`).getDate()), value: point.tickets }))}
          labelEvery={2}
          accessibilityLabel={`Ventes par jour sur 14 jours : ${dailyTotal} billets`}
        />
      </Card>

      {/* Places par type */}
      <SectionHeader title="Places par type" />
      <View style={styles.types}>
        {types.map((item) => (
          <Card key={item.ticketType.id} padding={16}>
            <View style={styles.typeHeader}>
              <AppText variant="h3">{item.ticketType.name}</AppText>
              <AppText variant="bodyStrong" color="success">
                {formatPrice(item.revenue, currency)}
              </AppText>
            </View>
            <ProgressBar
              total={item.ticketType.quantity}
              segments={[
                { value: item.sold, color: theme.primary },
                { value: item.held, color: theme.warning },
              ]}
            />
            <View style={styles.legend}>
              <Legend color={theme.primary} label="Vendues" value={item.sold} />
              <Legend color={theme.warning} label="Retenues" value={item.held} />
              <Legend color={theme.backgroundSelected} label="Libres" value={item.free} />
            </View>
          </Card>
        ))}
      </View>

      {/* Entrées le jour J */}
      <SectionHeader title="Entrées" />
      <Card padding={16}>
        {doorsOpen ? (
          <>
            <View style={styles.typeHeader}>
              <AppText variant="h3">Billets scannés</AppText>
              <AppText variant="bodyStrong">
                {formatNumber(data.entriesScanned)} / {formatNumber(totals.sold)}
              </AppText>
            </View>
            <ProgressBar total={totals.sold} segments={[{ value: data.entriesScanned, color: theme.success }]} />
          </>
        ) : (
          <AppText variant="small" color="textSecondary">
            Le compte des entrées est disponible le jour de l’événement, pendant le scan des billets.
          </AppText>
        )}
      </Card>
    </View>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <AppText variant="caption" color="textSecondary">
        {label} <AppText variant="caption" style={styles.legendValue}>{formatNumber(value)}</AppText>
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 12,
  },

  chips: {
    gap: 8,
    paddingBottom: 18,
  },

  banner: {
    marginBottom: 16,
  },

  details: {
    gap: 4,
  },

  eventHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },

  eventHeaderText: {
    flex: 1,
    gap: 2,
  },

  chartHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 14,
  },

  types: {
    gap: 12,
  },

  typeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 12,
  },

  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  legendValue: {
    fontWeight: 700,
  },
});
