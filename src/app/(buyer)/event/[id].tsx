import { router, useLocalSearchParams, usePathname } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { StatusBadge } from "@/components/event-card";
import { EventHero } from "@/components/event-hero";
import { EventInfo } from "@/components/event-info";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen, SCREEN_PADDING } from "@/components/ui/screen";
import { LoadBoundary } from "@/components/ui/state";
import { ContentWidth, Radius } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useSite } from "@/context/site";
import { useLoad } from "@/hooks/use-load";
import { useTheme } from "@/hooks/use-theme";
import { ApiError, errorMessage } from "@/services/api";
import { getEventById, getTicketTypes } from "@/services/evenservices";
import { reserveTickets } from "@/services/ticketservices";
import { Event } from "@/types/even";
import { PendingOrderDetails } from "@/types/order";
import { TicketType } from "@/types/ticket";
import { daysUntil, formatDateTime, formatPrice, relativeDay } from "@/utils/format";

type EventData = { event: Event; tickets: TicketType[] } | null; // null : introuvable

// Détail côté ACHETEUR : les informations, le choix des places et la réservation.
export default function BuyerEventScreen() {
  // Récupère le [id] de l'URL : /event/12 -> id = "12".
  const { id } = useLocalSearchParams<{ id: string }>();

  // L'événement et ses types de place : un événement qui n'est pas public (brouillon, annulé) est « introuvable »,
  // même si quelqu'un tape son adresse à la main : c'est le serveur qui décide, la réponse est la même que s'il n'existait pas.
  const load = useCallback(async (): Promise<EventData> => {
    const [event, tickets] = await Promise.all([
      getEventById(id),
      getTicketTypes(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return [] as TicketType[];
        throw error;
      }),
    ]);
    return event ? { event, tickets } : null;
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
              message="Cet événement n'existe pas ou n'est plus en vente."
              actionLabel="Retour à l'accueil"
              onAction={() => router.replace("/")}
            />
          </Screen>
        ) : (
          <EventDetail event={data.event} tickets={data.tickets} onStale={state.reload} />
        )
      }
    </LoadBoundary>
  );
}

// onStale : la situation a changé côté serveur (plus de places…) : l'écran relit l'événement et ses places.
function EventDetail({ event, tickets, onStale }: { event: Event; tickets: TicketType[]; onStale: () => void }) {
  const theme = useTheme();
  const pathname = usePathname();
  const { user, refreshUser } = useAuth();
  const site = useSite();

  const [selection, setSelection] = useState<Record<string, number>>({}); // ticketTypeId -> quantité choisie
  const [reserving, setReserving] = useState(false);
  const [problem, setProblem] = useState("");
  const [reserved, setReserved] = useState<PendingOrderDetails | null>(null);

  const soldOut = event.status === "sold_out";
  const count = Object.values(selection).reduce((sum, quantity) => sum + quantity, 0);
  // Une estimation : le prix définitif est celui que le serveur fixe au moment de la réservation (son horloge fait foi).
  const total = tickets.reduce((sum, ticket) => sum + ticket.currentPrice * (selection[ticket.id] ?? 0), 0);
  const days = daysUntil(event.date);
  const needsVerification = user !== null && !user.emailVerified;

  function changeQuantity(ticketTypeId: string, quantity: number) {
    setSelection({ ...selection, [ticketTypeId]: quantity });
    setProblem("");
  }

  function goToLogin() {
    // Après la connexion, on revient sur cet événement.
    router.push({ pathname: "/login", params: { redirect: pathname } });
  }

  async function handleReserve() {
    if (!user) return goToLogin();
    setReserving(true);
    setProblem("");
    try {
      const items = Object.entries(selection)
        .filter(([, quantity]) => quantity > 0)
        .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
      setReserved(await reserveTickets(event.id, items));
      setSelection({});
    } catch (error) {
      setProblem(errorMessage(error, "La réservation a échoué. Réessaie dans un instant."));
      if (error instanceof ApiError) {
        // Plus assez de places, ou l'événement a changé : on relit ce que le serveur propose maintenant.
        if (error.code === "sold_out" || error.code === "event_over") onStale();
        // L'adresse e-mail a peut-être été vérifiée depuis un autre appareil : on relit le compte.
        if (error.code === "email_not_verified") refreshUser().catch(() => undefined);
      }
    }
    setReserving(false);
  }

  const footer = (
    <View style={[styles.footer, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
      <View style={styles.footerInner}>
        {reserved ? (
          <>
            <Banner tone="success" title="Places réservées">
              {`Elles te sont réservées jusqu’au ${formatDateTime(reserved.order.expiresAt)}. Le paiement en ligne n’est pas encore disponible : sans paiement, elles seront rendues à la vente à cette échéance.`}
            </Banner>
            <Button title="Voir mes réservations" icon="hourglass" onPress={() => router.push("/dashboard")} />
            <Button
              title="Choisir d'autres places"
              variant="ghost"
              size="md"
              onPress={() => {
                setReserved(null);
                onStale();
              }}
            />
          </>
        ) : soldOut ? (
          <Banner tone="info" title="Événement complet">
            Il n’y a plus de place pour cet événement.
          </Banner>
        ) : (
          <>
            {needsVerification && <VerifyEmailBanner />}
            {problem !== "" && <Banner tone="danger">{problem}</Banner>}
            <View style={styles.footerRow}>
              <View>
                <AppText variant="caption" color="textSecondary">
                  {count === 0 ? "Aucune place choisie" : `${count} place${count > 1 ? "s" : ""}`}
                </AppText>
                <AppText variant="h2">{count === 0 ? "—" : formatPrice(total, event.currency)}</AppText>
              </View>
              <Button
                title={user ? "Réserver" : "Se connecter pour réserver"}
                onPress={handleReserve}
                disabled={count === 0 || needsVerification}
                loading={reserving}
                fullWidth={false}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );

  return (
    <Screen scroll padded={false} topInset={false} maxWidth={ContentWidth.content} footer={footer}>
      <EventHero event={event} />

      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.badges}>
          <StatusBadge status={event.status} />
          {days >= 0 && relativeDay(event.date) && <Badge label={relativeDay(event.date) ?? ""} tone="brand" icon="clock" />}
        </View>

        <AppText variant="h1" style={styles.title} accessibilityRole="header">
          {event.name}
        </AppText>

        <EventInfo
          event={event}
          tickets={tickets}
          selection={soldOut || reserved ? undefined : selection}
          onChangeQuantity={soldOut || reserved ? undefined : changeQuantity}
          maxPerOrder={site?.maxTicketsPerOrder}
        />
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
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },

  title: {
    marginBottom: 20,
  },

  footer: {
    borderTopWidth: 1,
    alignItems: "center",
    paddingHorizontal: SCREEN_PADDING,
    paddingVertical: 14,
  },

  footerInner: {
    width: "100%",
    maxWidth: ContentWidth.content,
    gap: 12,
  },

  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
});
