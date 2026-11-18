import { Href, Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { coverColors } from "@/components/event-cover";
import { AppText } from "@/components/ui/app-text";
import { Badge, BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { LinearGradient } from "expo-linear-gradient";
import { TicketDetails, TicketStatus } from "../types/order";
import { formatDateShort, formatDayNumber, formatMonthShort } from "../utils/format";

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  valid: "Valide",
  used: "Utilisé",
  canceled: "Annulé",
};

export const TICKET_STATUS_TONES: Record<TicketStatus, BadgeTone> = {
  valid: "success",
  used: "neutral",
  canceled: "danger",
};

// Un billet dans la liste "Mes billets" : une carte en forme de ticket (encoches sur les côtés, ligne pointillée).
export function TicketCard({ details, href }: { details: TicketDetails; href: Href }) {
  const { ticket, event, ticketType } = details;

  return (
    // L'habillage est dans TicketCardContent : un style en fonction sur un Pressable placé sous <Link asChild> serait perdu.
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Billet ${ticketType.name} pour ${event.name}, ${formatDateShort(event.date)}, ${TICKET_STATUS_LABELS[ticket.status]}`}>
        {({ pressed }) => <TicketCardContent details={details} pressed={pressed} />}
      </Pressable>
    </Link>
  );
}

function TicketCardContent({ details, pressed }: { details: TicketDetails; pressed: boolean }) {
  const theme = useTheme();
  const { ticket, event, ticketType } = details;
  const inactive = ticket.status !== "valid";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: Shadow.card },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.top, inactive && styles.dimmed]}>
        <LinearGradient colors={coverColors(event.id)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dateBlock}>
          <AppText variant="h2" color="#FFFFFF" style={styles.dateDay}>
            {formatDayNumber(event.date)}
          </AppText>
          <AppText variant="eyebrow" color="#FFFFFF" style={styles.dateMonth}>
            {formatMonthShort(event.date)}
          </AppText>
        </LinearGradient>

        <View style={styles.info}>
          <AppText variant="h3" numberOfLines={2}>
            {event.name}
          </AppText>
          <AppText variant="small" color="textSecondary">
            {event.startTime} · {ticketType.name}
          </AppText>
          <View style={styles.location}>
            <Icon name="pin" size={14} color="textSecondary" />
            <AppText variant="small" color="textSecondary" numberOfLines={1} style={styles.locationText}>
              {event.location}
            </AppText>
          </View>
        </View>
      </View>

      {/* La ligne pointillée et ses deux encoches (couleur du fond de l'écran : elles "découpent" la carte). */}
      <View style={styles.perforation}>
        <View style={[styles.notch, styles.notchLeft, { backgroundColor: theme.background }]} />
        <View style={styles.dashes}>
          {Array.from({ length: 26 }, (_, index) => (
            <View key={index} style={[styles.dash, { backgroundColor: theme.borderStrong }]} />
          ))}
        </View>
        <View style={[styles.notch, styles.notchRight, { backgroundColor: theme.background }]} />
      </View>

      <View style={styles.bottom}>
        <Badge label={TICKET_STATUS_LABELS[ticket.status]} tone={TICKET_STATUS_TONES[ticket.status]} />
        <View style={styles.cta}>
          <AppText variant="smallStrong" color="primary">
            {ticket.status === "valid" ? "Afficher le QR code" : "Voir le billet"}
          </AppText>
          <Icon name="chevronRight" size={16} color="primary" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },

  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },

  top: {
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },

  dimmed: {
    opacity: 0.6,
  },

  dateBlock: {
    width: 60,
    height: 68,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },

  dateDay: {
    lineHeight: 28,
  },

  dateMonth: {
    fontSize: 11,
    lineHeight: 14,
  },

  info: {
    flex: 1,
    gap: 3,
    justifyContent: "center",
  },

  location: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  locationText: {
    flex: 1,
  },

  perforation: {
    height: 20,
    justifyContent: "center",
  },

  dashes: {
    flexDirection: "row",
    gap: 6,
    marginHorizontal: 18,
  },

  dash: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },

  notch: {
    position: "absolute",
    top: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
  },

  notchLeft: {
    left: -10,
  },

  notchRight: {
    right: -10,
  },

  bottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },

  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
});
