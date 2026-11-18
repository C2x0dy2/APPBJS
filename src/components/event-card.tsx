import { LinearGradient } from "expo-linear-gradient";
import { Href, Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { EventCover } from "@/components/event-cover";
import { AppText } from "@/components/ui/app-text";
import { Badge, BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { Event, EvenStatus } from "../types/even";
import { daysUntil, formatDateShort, formatDayNumber, formatMonthShort, formatPrice, relativeDay, statusLabels } from "../utils/format";

// Carte d'un événement dans une liste. Utilisée par les DEUX espaces :
// seul "href" change (détail acheteur ou détail organisateur).
type EventCardProps = { event: Event; href: Href };

// Le prix "dès" que calcule le serveur (null : aucune place à vendre pour l'instant).
function startingPrice(event: Event): string {
  if (event.fromPrice === null) return "Pas encore de tarif";
  return event.fromPrice === 0 ? "Gratuit" : `dès ${formatPrice(event.fromPrice, event.currency)}`;
}

export function EventCard({ event, href }: EventCardProps) {
  return (
    // Link + asChild : toute la carte devient cliquable.
    // L'habillage (fond, bord, ombre) est dans EventCardContent et non dans le style du Pressable :
    // un style en fonction sur un Pressable placé sous <Link asChild> serait perdu.
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${event.name}, ${formatDateShort(event.date)}, ${statusLabels[event.status]}`}>
        {({ pressed }) => <EventCardContent event={event} pressed={pressed} />}
      </Pressable>
    </Link>
  );
}

function EventCardContent({ event, pressed }: { event: Event; pressed: boolean }) {
  const theme = useTheme();
  const when = daysUntil(event.date) >= 0 ? (relativeDay(event.date) ?? formatDateShort(event.date)) : formatDateShort(event.date);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, boxShadow: Shadow.card },
        pressed && styles.pressed,
      ]}>
      <EventCover event={event} height={116}>
        {/* Pastille de date en haut à gauche */}
        <View style={styles.dateChip}>
          <AppText variant="h3" color="#1D0B33" style={styles.dateDay}>
            {formatDayNumber(event.date)}
          </AppText>
          <AppText variant="eyebrow" color="#D6168A" style={styles.dateMonth}>
            {formatMonthShort(event.date)}
          </AppText>
        </View>

        {/* Statut en haut à droite */}
        <View style={styles.statusSlot}>
          <StatusBadge status={event.status} solid />
        </View>
      </EventCover>

      <View style={styles.body}>
        <AppText variant="h3" numberOfLines={2}>
          {event.name}
        </AppText>

        <View style={styles.infoRow}>
          <Icon name={event.isOnline ? "globe" : "pin"} size={16} color="textSecondary" />
          <AppText variant="small" color="textSecondary" numberOfLines={1} style={styles.infoText}>
            {event.location}
          </AppText>
        </View>
        <View style={styles.infoRow}>
          <Icon name="clock" size={16} color="textSecondary" />
          <AppText variant="small" color="textSecondary" style={styles.infoText}>
            {when} · {event.startTime}
          </AppText>
        </View>

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <AppText variant="bodyStrong" color={event.fromPrice === null ? "textTertiary" : "primary"}>
            {startingPrice(event)}
          </AppText>
          <Icon name="chevronRight" size={18} color="textTertiary" />
        </View>
      </View>
    </View>
  );
}

// L'événement mis en avant en haut de l'accueil : une grande pochette avec le titre posé dessus.
export function FeaturedEventCard({ event, href }: EventCardProps) {
  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`À la une : ${event.name}, ${formatDateShort(event.date)}`}>
        {({ pressed }) => <FeaturedEventContent event={event} pressed={pressed} />}
      </Pressable>
    </Link>
  );
}

function FeaturedEventContent({ event, pressed }: { event: Event; pressed: boolean }) {
  const when = relativeDay(event.date) ?? formatDateShort(event.date);

  return (
    <View style={[styles.featured, { boxShadow: Shadow.raised }, pressed && styles.pressed]}>
      <EventCover event={event} height={230}>
        {/* Un voile sombre en bas : le texte blanc reste lisible quelle que soit la couleur de la pochette. */}
        <LinearGradient colors={["rgba(18, 4, 31, 0)", "rgba(18, 4, 31, 0.78)"]} style={styles.featuredShade} />

        <View style={styles.featuredTop}>
          <Badge label="Prochain événement" tone="brand" solid icon="sparkles" />
          <StatusBadge status={event.status} solid />
        </View>

        <View style={styles.featuredBottom}>
          <AppText variant="h1" color="#FFFFFF" numberOfLines={2}>
            {event.name}
          </AppText>
          <View style={styles.featuredMeta}>
            <Icon name="calendar" size={16} color="#FFFFFF" />
            <AppText variant="smallStrong" color="#FFFFFF">
              {when} · {event.startTime}
            </AppText>
            <Icon name={event.isOnline ? "globe" : "pin"} size={16} color="#FFFFFF" style={styles.featuredMetaIcon} />
            <AppText variant="smallStrong" color="#FFFFFF" numberOfLines={1} style={styles.featuredMetaText}>
              {event.location}
            </AppText>
          </View>
          {event.fromPrice !== null && (
            <AppText variant="bodyStrong" color="#FFFFFF">
              {startingPrice(event)}
            </AppText>
          )}
        </View>
      </EventCover>
    </View>
  );
}

const STATUS_TONES: Record<EvenStatus, BadgeTone> = {
  draft: "neutral",
  on_sale: "success",
  sold_out: "danger",
  finished: "neutral",
  canceled: "warning",
};

export function StatusBadge({ status, solid = false }: { status: EvenStatus; solid?: boolean }) {
  return <Badge label={statusLabels[status]} tone={STATUS_TONES[status]} solid={solid} />;
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

  dateChip: {
    position: "absolute",
    top: 12,
    left: 12,
    minWidth: 52,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.md,
    backgroundColor: "#FFFFFF",
  },

  dateDay: {
    lineHeight: 22,
  },

  dateMonth: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
  },

  statusSlot: {
    position: "absolute",
    top: 12,
    right: 12,
  },

  body: {
    padding: 16,
    gap: 6,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  infoText: {
    flex: 1,
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
  },

  featured: {
    borderRadius: Radius.xl,
    overflow: "hidden",
  },

  featuredShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "75%",
  },

  featuredTop: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  featuredBottom: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
    gap: 6,
  },

  featuredMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  featuredMetaIcon: {
    marginLeft: 10,
  },

  featuredMetaText: {
    flexShrink: 1,
  },
});
