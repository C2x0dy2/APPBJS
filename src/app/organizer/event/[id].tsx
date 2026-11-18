import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { StatusBadge } from "@/components/event-card";
import { EventHero } from "@/components/event-hero";
import { EventImageEditor } from "@/components/event-image-editor";
import { EventInfo } from "@/components/event-info";
import { AppText } from "@/components/ui/app-text";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Screen, SCREEN_PADDING } from "@/components/ui/screen";
import { LoadBoundary } from "@/components/ui/state";
import { ContentWidth, Radius } from "@/constants/theme";
import { useLoad } from "@/hooks/use-load";
import { useTheme } from "@/hooks/use-theme";
import { errorMessage } from "@/services/api";
import { cancelEvent, deleteEvent, getEventStats, getOrganizerEvent, getOrganizerTicketTypes } from "@/services/organizerservices";
import { Event } from "@/types/even";
import { EventStats } from "@/types/organizer";
import { OrganizerTicketType } from "@/types/ticket";
import { confirmAction } from "@/utils/confirm";
import { formatNumber, formatPercent, formatPrice } from "@/utils/format";

type EventData = { event: Event; tickets: OrganizerTicketType[]; stats: EventStats | null } | null; // null : introuvable

// Détail côté ORGANISATEUR : mêmes infos que l'acheteur + les chiffres de vente et les actions de gestion.
export default function OrganizerEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // Cloisonnement : le serveur répond « introuvable » pour l'événement d'un autre collectif, comme s'il n'existait pas.
  const load = useCallback(async (): Promise<EventData> => {
    const event = await getOrganizerEvent(id);
    if (!event) return null;
    // Un brouillon n'a aucune vente à montrer.
    const [tickets, stats] = await Promise.all([getOrganizerTicketTypes(id), event.status === "draft" ? null : getEventStats(id)]);
    return { event, tickets, stats };
  }, [id]);
  const state = useLoad(load);

  return (
    <LoadBoundary state={state}>
      {(data) =>
        data === null ? (
          <Screen>
            <EmptyState
              icon="calendar"
              title="Événement introuvable"
              message="Cet événement n'existe pas, ou il appartient à un autre collectif."
              actionLabel="Mes événements"
              onAction={() => router.replace("/organizer")}
            />
          </Screen>
        ) : (
          <OrganizerEvent event={data.event} tickets={data.tickets} stats={data.stats} onChanged={state.reload} />
        )
      }
    </LoadBoundary>
  );
}

type OrganizerEventProps = { event: Event; tickets: OrganizerTicketType[]; stats: EventStats | null; onChanged: () => void };

function OrganizerEvent({ event, tickets, stats, onChanged }: OrganizerEventProps) {
  const theme = useTheme();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCancel() {
    const ok = await confirmAction(
      "Annuler l'événement ?",
      "Plus aucune place ne sera vendue, les billets déjà émis seront annulés et les paiements reçus seront à rembourser. Cette action est définitive.",
      "Annuler l'événement"
    );
    if (!ok) return;
    setBusy(true);
    setProblem("");
    try {
      await cancelEvent(event.id);
      onChanged();
    } catch (error) {
      setProblem(errorMessage(error, "L'annulation a échoué. Réessaie."));
    }
    setBusy(false);
  }

  async function handleDelete() {
    const ok = await confirmAction(
      "Supprimer le brouillon ?",
      "L'événement et ses types de places seront effacés.",
      "Supprimer"
    );
    if (!ok) return;
    setBusy(true);
    setProblem("");
    try {
      await deleteEvent(event.id);
      // Arrivé par un lien direct, il n'y a pas d'écran précédent : on retourne à la liste des événements.
      if (router.canGoBack()) router.back();
      else router.replace("/organizer");
    } catch (error) {
      setProblem(errorMessage(error, "La suppression a échoué. Réessaie."));
      setBusy(false);
    }
  }

  // Quelles actions selon le statut :
  //   brouillon         -> Modifier, Supprimer (rien n'a été vendu)
  //   en vente / complet -> Modifier, Annuler
  //   terminé / annulé  -> plus aucune action
  const canEdit = event.status === "draft" || event.status === "on_sale" || event.status === "sold_out";
  const canDelete = event.status === "draft";
  const canCancel = event.status === "on_sale" || event.status === "sold_out";

  return (
    <Screen scroll padded={false} topInset={false} maxWidth={ContentWidth.content}>
      <EventHero event={event} />

      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.badges}>
          <StatusBadge status={event.status} />
        </View>
        <AppText variant="h1" style={styles.title} accessibilityRole="header">
          {event.name}
        </AppText>

        {event.status === "canceled" && (
          <Banner tone="warning" title="Événement annulé" style={styles.banner}>
            Les billets sont annulés. Les paiements déjà reçus sont à rembourser : le tableau de bord en donne le total.
          </Banner>
        )}

        {/* Un résumé des ventes, avec un lien vers le tableau de bord complet. */}
        {stats && (
          <Card style={styles.sales} padding={16}>
            <View style={styles.salesTop}>
              <View>
                <AppText variant="caption" color="textSecondary">
                  Places vendues
                </AppText>
                <AppText variant="h2">
                  {formatNumber(stats.totals.sold)} / {formatNumber(stats.totals.capacity)}
                </AppText>
              </View>
              <View style={styles.salesRight}>
                <AppText variant="caption" color="textSecondary">
                  Argent encaissé
                </AppText>
                <AppText variant="h2" color="success">
                  {formatPrice(stats.totals.revenue, event.currency)}
                </AppText>
              </View>
            </View>
            <ProgressBar
              total={stats.totals.capacity}
              segments={[
                { value: stats.totals.sold, color: theme.primary },
                { value: stats.totals.held, color: theme.warning },
              ]}
            />
            <AppText variant="caption" color="textSecondary" style={styles.salesNote}>
              {formatPercent(stats.totals.fillRate)} de remplissage
            </AppText>
            <Button
              title="Voir le tableau de bord"
              icon="chart"
              variant="secondary"
              size="md"
              onPress={() => router.navigate({ pathname: "/organizer/dashboard", params: { eventId: event.id } })}
              style={styles.salesButton}
            />
          </Card>
        )}

        <EventInfo event={event} tickets={tickets} showCapacity />

        {canEdit && <EventImageEditor event={event} onChanged={onChanged} />}

        <View style={styles.actions}>
          {problem !== "" && <Banner tone="danger">{problem}</Banner>}

          {canEdit && (
            <Button
              title="Modifier"
              icon="edit"
              onPress={() => router.push({ pathname: "/organizer/event/edit/[id]", params: { id: event.id } })}
              disabled={busy}
            />
          )}

          {canDelete && <Button title="Supprimer le brouillon" icon="trash" variant="danger" onPress={handleDelete} loading={busy} />}

          {canCancel && <Button title="Annuler l'événement" icon="close" variant="danger" onPress={handleCancel} loading={busy} />}

          {!canEdit && <Banner tone="info">Cet événement ne peut plus être modifié.</Banner>}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sheet: {
    marginTop: -28,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 24,
    paddingBottom: 16,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },

  badges: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },

  title: {
    marginBottom: 20,
  },

  banner: {
    marginBottom: 20,
  },

  sales: {
    marginBottom: 24,
  },

  salesTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 14,
  },

  salesRight: {
    alignItems: "flex-end",
  },

  salesNote: {
    marginTop: 8,
  },

  salesButton: {
    marginTop: 14,
  },

  actions: {
    marginTop: 24,
    gap: 12,
  },
});
