import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon, IconName } from "@/components/ui/icon";
import { useTheme } from "@/hooks/use-theme";
import { Event } from "../types/even";
import { OrganizerTicketType, TicketType } from "../types/ticket";
import { formatDate, formatDateShort, formatPrice } from "../utils/format";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Le contenu du détail d'un événement : les informations pratiques, puis les types de places.
// Partagé par les deux espaces ; chaque écran ajoute ses propres boutons autour.
//   - Côté acheteur : selection + onChangeQuantity affichent un sélecteur de quantité sur chaque place.
//     maxPerOrder : le nombre maximum de places par réservation, tous types confondus (règle du serveur ; inconnue = pas de limite ici,
//     le serveur la fait respecter dans tous les cas).
//   - Côté organisateur : showCapacity affiche le nombre de places mises en vente, et leurs ventes quand le serveur les fournit.
type EventInfoProps = {
  event: Event;
  tickets: (TicketType | OrganizerTicketType)[];
  selection?: Record<string, number>;
  onChangeQuantity?: (ticketTypeId: string, quantity: number) => void;
  maxPerOrder?: number;
  showCapacity?: boolean;
};

export function EventInfo({ event, tickets, selection, onChangeQuantity, maxPerOrder, showCapacity = false }: EventInfoProps) {
  const chosen = Object.values(selection ?? {}).reduce((sum, quantity) => sum + quantity, 0);

  return (
    <View>
      <Card style={styles.infoCard} padding={4}>
        <InfoRow icon="calendar" title={capitalize(formatDate(event.date))} />
        <InfoRow
          icon="clock"
          title={`Début à ${event.startTime}`}
          subtitle={event.doorsOpenTime ? `Ouverture des portes à ${event.doorsOpenTime}` : undefined}
        />
        <InfoRow icon="pin" title={event.location} />
        {/* Le fuseau est toujours affiché : utile pour les participants à l'étranger. */}
        <InfoRow icon="globe" title={`Heures du fuseau ${event.timezone}`} />
        <InfoRow icon="undo" title={`Annulation possible jusqu'au ${formatDateShort(event.cancellationDeadline)}`} last />
      </Card>

      <AppText variant="h2" style={styles.sectionTitle}>
        {onChangeQuantity ? "Choisis tes places" : "Types de places"}
      </AppText>

      {tickets.length === 0 && (
        <AppText variant="small" color="textSecondary">
          Aucune place n’est encore proposée pour cet événement.
        </AppText>
      )}

      {tickets.map((ticket) => (
        <TicketTypeRow
          key={ticket.id}
          ticket={ticket}
          event={event}
          quantity={selection?.[ticket.id] ?? 0}
          onChangeQuantity={onChangeQuantity && !ticket.soldOut ? (quantity) => onChangeQuantity(ticket.id, quantity) : undefined}
          // On peut en ajouter tant que la réservation n'est pas pleine et qu'il reste des places de ce type.
          canAdd={(maxPerOrder === undefined || chosen < maxPerOrder) && (selection?.[ticket.id] ?? 0) < (ticket.remaining ?? Infinity)}
          showCapacity={showCapacity}
        />
      ))}
    </View>
  );
}

function InfoRow({ icon, title, subtitle, last = false }: { icon: IconName; title: string; subtitle?: string; last?: boolean }) {
  const theme = useTheme();

  return (
    <View style={[styles.infoRow, !last && { borderBottomColor: theme.border, borderBottomWidth: 1 }]}>
      <View style={[styles.infoIcon, { backgroundColor: theme.primarySoft }]}>
        <Icon name={icon} size={18} color="primary" />
      </View>
      <View style={styles.infoText}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle && (
          <AppText variant="small" color="textSecondary">
            {subtitle}
          </AppText>
        )}
      </View>
    </View>
  );
}

type TicketTypeRowProps = {
  ticket: TicketType | OrganizerTicketType;
  event: Event;
  quantity: number;
  onChangeQuantity?: (quantity: number) => void;
  canAdd: boolean;
  showCapacity: boolean;
};

function TicketTypeRow({ ticket, event, quantity, onChangeQuantity, canAdd, showCapacity }: TicketTypeRowProps) {
  const theme = useTheme();
  // Le serveur donne le prix facturé maintenant : le tarif early n'apparaît que tant qu'il est valable.
  const price = ticket.currentPrice;
  const isEarly = ticket.earlyPrice !== undefined;

  return (
    <Card style={[styles.ticket, quantity > 0 && { borderColor: theme.primary }]} padding={16} elevated={false}>
      <View style={styles.ticketTop}>
        <View style={styles.ticketName}>
          <AppText variant="h3">{ticket.name}</AppText>
          {ticket.soldOut && <Badge label="Complet" tone="danger" />}
          {isEarly && !ticket.soldOut && <Badge label="Tarif early" tone="success" icon="sparkles" />}
        </View>

        <View style={styles.ticketPrice}>
          <AppText variant="h3" color="primary">
            {formatPrice(price, event.currency)}
          </AppText>
          {/* Prix normal barré quand le tarif early s'applique. */}
          {isEarly && (
            <AppText variant="caption" color="textTertiary" style={styles.oldPrice}>
              {formatPrice(ticket.price, event.currency)}
            </AppText>
          )}
        </View>
      </View>

      <View style={styles.ticketBottom}>
        <View style={styles.ticketMeta}>
          {showCapacity && (
            <AppText variant="small" color="textSecondary">
              {"sold" in ticket ? `${ticket.sold} vendues · ${ticket.held} retenues sur ${ticket.quantity} places` : `${ticket.quantity} places`}
            </AppText>
          )}
          {/* Le serveur ne donne le nombre exact qu'à partir d'un seuil : sinon, aucune indication sur le rythme des ventes. */}
          {ticket.remaining !== null && !ticket.soldOut && (
            <AppText variant="smallStrong" color="warning">
              Plus que {ticket.remaining} place{ticket.remaining > 1 ? "s" : ""}
            </AppText>
          )}
          {isEarly && ticket.earlyPriceDeadline && (
            <AppText variant="small" color="success">
              Jusqu’au {formatDateShort(ticket.earlyPriceDeadline)}
            </AppText>
          )}
        </View>

        {onChangeQuantity && <QuantityStepper value={quantity} onChange={onChangeQuantity} canAdd={canAdd} />}
      </View>
    </Card>
  );
}

function QuantityStepper({ value, onChange, canAdd }: { value: number; onChange: (value: number) => void; canAdd: boolean }) {
  const theme = useTheme();

  return (
    <View style={styles.stepper}>
      <StepButton icon="minus" label="Retirer une place" disabled={value <= 0} onPress={() => onChange(value - 1)} />
      <AppText variant="bodyStrong" style={[styles.stepperValue, { color: theme.text }]} accessibilityLiveRegion="polite">
        {value}
      </AppText>
      <StepButton icon="plus" label="Ajouter une place" disabled={!canAdd} onPress={() => onChange(value + 1)} />
    </View>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: IconName; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.stepButton,
        { backgroundColor: disabled ? theme.backgroundElement : theme.primarySoft },
        pressed && { opacity: 0.7 },
      ]}>
      <Icon name={icon} size={18} color={disabled ? "textTertiary" : "primary"} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  infoCard: {
    marginBottom: 28,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },

  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  infoText: {
    flex: 1,
  },

  sectionTitle: {
    marginBottom: 14,
  },

  ticket: {
    marginBottom: 12,
    borderWidth: 1.5,
  },

  ticketTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },

  ticketName: {
    flex: 1,
    gap: 6,
  },

  ticketPrice: {
    alignItems: "flex-end",
  },

  oldPrice: {
    textDecorationLine: "line-through",
  },

  ticketBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 12,
  },

  ticketMeta: {
    flex: 1,
  },

  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  stepperValue: {
    minWidth: 32,
    textAlign: "center",
  },

  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
