import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";

import { coverColors } from "@/components/event-cover";
import { PendingOrderCard } from "@/components/pending-order-card";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { AppText } from "@/components/ui/app-text";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Screen, SectionHeader } from "@/components/ui/screen";
import { StatTile } from "@/components/ui/stat-tile";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { ContentWidth, Radius } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useLoad } from "@/hooks/use-load";
import { getMyPendingOrders, getMyTickets } from "@/services/ticketservices";
import { daysUntil, formatDate, relativeDay } from "@/utils/format";

// Tableau de bord de l'ACHETEUR : son prochain événement et ses réservations en cours.
export default function BuyerDashboardScreen() {
  const { user } = useAuth();

  const load = useCallback(async () => {
    const [tickets, pending] = await Promise.all([getMyTickets(), getMyPendingOrders()]);
    return { tickets, pending };
  }, []);
  const { data, error, loading, reload } = useLoad(load, user !== null);

  if (!user) {
    return (
      <Screen>
        <SignInPrompt
          icon="chart"
          title="Ton tableau de bord"
          message="Connecte-toi pour suivre tes billets et tes réservations en cours."
        />
      </Screen>
    );
  }

  const upcoming = (data?.tickets ?? []).filter((details) => details.ticket.status === "valid" && daysUntil(details.event.date) >= 0);
  const pastEvents = new Set(
    (data?.tickets ?? []).filter((details) => !(details.ticket.status === "valid" && daysUntil(details.event.date) >= 0)).map((details) => details.event.id)
  );
  const next = upcoming[0];
  const days = next ? daysUntil(next.event.date) : 0;

  return (
    <Screen maxWidth={ContentWidth.wide}>
      <View style={styles.header}>
        <Avatar name={user.name} size={52} />
        <View style={styles.headerText}>
          <AppText variant="h1">Bonjour {user.name}</AppText>
          <AppText variant="body" color="textSecondary">
            Voici le résumé de ton compte.
          </AppText>
        </View>
      </View>

      <VerifyEmailBanner style={styles.banner} />

      {loading && <LoadingState />}
      {data === undefined && error ? <ErrorState error={error} onRetry={reload} /> : null}

      {data && (
        <>
          {/* Prochain événement */}
          {next ? (
            <LinearGradient colors={coverColors(next.event.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.next}>
              <View style={styles.nextCircle} />
              <AppText variant="eyebrow" color="rgba(255, 255, 255, 0.85)">
                Prochain événement
              </AppText>
              <AppText variant="h1" color="#FFFFFF" numberOfLines={2}>
                {next.event.name}
              </AppText>
              <View style={styles.nextMeta}>
                <Icon name="calendar" size={16} color="#FFFFFF" />
                <AppText variant="smallStrong" color="#FFFFFF">
                  {relativeDay(next.event.date) ?? `Dans ${days} jours`} · {next.event.startTime}
                </AppText>
              </View>
              <AppText variant="small" color="rgba(255, 255, 255, 0.88)" style={styles.nextDate}>
                {formatDate(next.event.date)} — {next.event.location}
              </AppText>
              <View style={styles.nextButtons}>
                <Button
                  title="Voir mon billet"
                  icon="qr"
                  size="md"
                  fullWidth={false}
                  variant="secondary"
                  onPress={() => router.push({ pathname: "/ticket/[id]", params: { id: next.ticket.id } })}
                />
              </View>
            </LinearGradient>
          ) : (
            <Card style={styles.noNext}>
              <EmptyState
                icon="calendar"
                title="Aucun événement à venir"
                message="Réserve une place : ton prochain événement s'affichera ici."
                actionLabel="Découvrir les événements"
                onAction={() => router.push("/")}
              />
            </Card>
          )}

          {/* Chiffres clés */}
          <View style={styles.stats}>
            <StatTile icon="ticket" label="Billets à venir" value={String(upcoming.length)} tone="brand" />
            <StatTile icon="check" label="Événements passés" value={String(pastEvents.size)} tone="success" />
            <StatTile icon="hourglass" label="Réservations en attente" value={String(data.pending.length)} tone="warning" />
          </View>

          {/* Réservations en attente de paiement */}
          {data.pending.length > 0 && (
            <View>
              <SectionHeader title="Réservations en cours" />
              <Banner tone="info" style={styles.pendingNote}>
                Le paiement en ligne n’est pas encore disponible : tes places restent bloquées jusqu’à l’échéance, puis sont rendues à la vente.
              </Banner>
              <View style={styles.list}>
                {data.pending.map((details) => (
                  <PendingOrderCard key={details.order.id} details={details} />
                ))}
              </View>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 20,
  },

  headerText: {
    flex: 1,
  },

  banner: {
    marginBottom: 16,
  },

  next: {
    borderRadius: Radius.xl,
    padding: 22,
    gap: 6,
    overflow: "hidden",
  },

  nextCircle: {
    position: "absolute",
    width: 240,
    height: 240,
    right: -80,
    top: -100,
    borderRadius: 120,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },

  nextMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },

  nextDate: {
    marginBottom: 4,
  },

  nextButtons: {
    marginTop: 10,
  },

  noNext: {
    padding: 0,
  },

  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 16,
    marginBottom: 12,
  },

  pendingNote: {
    marginBottom: 12,
  },

  list: {
    gap: 12,
  },
});
