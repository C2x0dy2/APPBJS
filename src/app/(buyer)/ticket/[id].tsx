import { router, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";

import { EventHero } from "@/components/event-hero";
import { QrCode } from "@/components/qr-code";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { TICKET_STATUS_LABELS, TICKET_STATUS_TONES } from "@/components/ticket-card";
import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, IconName } from "@/components/ui/icon";
import { Screen, SCREEN_PADDING } from "@/components/ui/screen";
import { LoadBoundary } from "@/components/ui/state";
import { ContentWidth, Radius, Shadow } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useLoad } from "@/hooks/use-load";
import { useTheme } from "@/hooks/use-theme";
import { getTicketDetails } from "@/services/ticketservices";
import { TicketDetails } from "@/types/order";
import { formatDate, formatDateTime } from "@/utils/format";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// "Tk3vQ8mXw2LpR7nYb4ZcHa" -> "Tk3v Q8mX w2Lp R7nY b4Zc Ha" : plus facile à lire à voix haute.
const groupCode = (code: string) => code.match(/.{1,4}/g)?.join(" ") ?? code;

// Le billet : son QR code, à présenter à l'entrée. Un billet ne peut être scanné qu'une seule fois.
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  // Le serveur ne renvoie que les billets de la personne connectée : celui d'un autre compte est « introuvable », comme s'il n'existait pas.
  const load = useCallback(() => getTicketDetails(id), [id]);
  const state = useLoad(load, user !== null);

  if (!user) {
    return (
      <Screen>
        <SignInPrompt icon="qr" title="Ton billet" message="Connecte-toi pour afficher ton billet et son QR code." />
      </Screen>
    );
  }

  return (
    <LoadBoundary state={state}>
      {(details) =>
        details === null ? (
          <Screen>
            <EmptyState
              icon="ticket"
              title="Billet introuvable"
              message="Ce billet n'existe pas, ou il appartient à un autre compte."
              actionLabel="Voir mes billets"
              onAction={() => router.replace("/tickets")}
            />
          </Screen>
        ) : (
          <TicketView details={details} />
        )
      }
    </LoadBoundary>
  );
}

function TicketView({ details }: { details: TicketDetails }) {
  const theme = useTheme();
  const { ticket, event, ticketType } = details;
  const valid = ticket.status === "valid";

  return (
    <Screen scroll padded={false} topInset={false} maxWidth={ContentWidth.form}>
      <EventHero event={event} height={150} />

      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        {/* Le billet : informations, ligne pointillée avec encoches, puis le QR code */}
        <View style={[styles.ticket, { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: Shadow.raised }]}>
          <View style={styles.ticketTop}>
            <View style={styles.ticketHeader}>
              <AppText variant="eyebrow" color="primary">
                {ticketType.name}
              </AppText>
              <Badge label={TICKET_STATUS_LABELS[ticket.status]} tone={TICKET_STATUS_TONES[ticket.status]} />
            </View>
            <AppText variant="h2" style={styles.ticketTitle}>
              {event.name}
            </AppText>
            <TicketLine icon="calendar" text={`${capitalize(formatDate(event.date))} · ${event.startTime}`} />
            <TicketLine icon="pin" text={event.location} />
          </View>

          <View style={styles.perforation}>
            <View style={[styles.notch, styles.notchLeft, { backgroundColor: theme.background }]} />
            <View style={styles.dashes}>
              {Array.from({ length: 28 }, (_, index) => (
                <View key={index} style={[styles.dash, { backgroundColor: theme.borderStrong }]} />
              ))}
            </View>
            <View style={[styles.notch, styles.notchRight, { backgroundColor: theme.background }]} />
          </View>

          <View style={styles.ticketBottom}>
            <View style={styles.qrBox}>
              <QrCode value={ticket.code} size={216} />
              {!valid && (
                <View style={styles.stamp}>
                  {/* Un tampon posé sur le QR code : on voit tout de suite qu'il n'est plus utilisable. */}
                  <View style={[styles.stampBox, { borderColor: ticket.status === "canceled" ? "#C42B23" : "#675A75" }]}>
                    <AppText variant="h2" color={ticket.status === "canceled" ? "#C42B23" : "#675A75"} style={styles.stampText}>
                      {TICKET_STATUS_LABELS[ticket.status].toUpperCase()}
                    </AppText>
                  </View>
                </View>
              )}
            </View>
            <AppText variant="mono" color="textSecondary" selectable style={styles.code}>
              {groupCode(ticket.code)}
            </AppText>
          </View>
        </View>

        {valid ? (
          <Banner tone="success" title="Billet valide" style={styles.banner}>
            Présente ce QR code à l’entrée. Il ne peut être scanné qu’une seule fois : ne le partage pas.
          </Banner>
        ) : ticket.status === "used" ? (
          <Banner tone="info" title="Billet déjà utilisé" style={styles.banner}>
            {ticket.usedAt ? `Il a été scanné à l'entrée le ${formatDateTime(ticket.usedAt)}.` : "Il a déjà été scanné à l'entrée."}
          </Banner>
        ) : (
          <Banner tone="danger" title="Billet annulé" style={styles.banner}>
            Ce billet n’est plus valable.
          </Banner>
        )}

        <Card padding={4}>
          <DetailRow label="Type de place" value={ticketType.name} />
          <DetailRow label="Début" value={event.startTime} />
          {event.doorsOpenTime !== null && <DetailRow label="Ouverture des portes" value={event.doorsOpenTime} />}
          <DetailRow label="Fuseau horaire" value={event.timezone} last />
        </Card>
      </View>
    </Screen>
  );
}

function TicketLine({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.line}>
      <Icon name={icon} size={16} color="textSecondary" />
      <AppText variant="small" color="textSecondary" style={styles.lineText}>
        {text}
      </AppText>
    </View>
  );
}

function DetailRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const theme = useTheme();

  return (
    <View style={[styles.detailRow, !last && { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
      <AppText variant="small" color="textSecondary">
        {label}
      </AppText>
      <AppText variant="smallStrong">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    marginTop: -40,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 0,
    paddingBottom: 16,
    gap: 16,
  },

  ticket: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    overflow: "hidden",
  },

  ticketTop: {
    padding: 20,
    gap: 6,
  },

  ticketHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  ticketTitle: {
    marginBottom: 6,
  },

  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  lineText: {
    flex: 1,
  },

  perforation: {
    height: 24,
    justifyContent: "center",
  },

  dashes: {
    flexDirection: "row",
    gap: 6,
    marginHorizontal: 22,
  },

  dash: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },

  notch: {
    position: "absolute",
    top: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
  },

  notchLeft: {
    left: -12,
  },

  notchRight: {
    right: -12,
  },

  ticketBottom: {
    alignItems: "center",
    gap: 14,
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },

  // Le QR code reste toujours sur fond blanc : c'est ce qui le rend lisible par un scanner, même en mode sombre.
  qrBox: {
    padding: 8,
    borderRadius: Radius.lg,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6DFEE",
  },

  stamp: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.86)",
    borderRadius: Radius.lg,
  },

  stampBox: {
    borderWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    transform: [{ rotate: "-12deg" }],
  },

  stampText: {
    letterSpacing: 4,
  },

  code: {
    textAlign: "center",
  },

  banner: {
    marginTop: 0,
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
});
