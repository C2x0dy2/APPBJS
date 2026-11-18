import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useCountdown } from "@/hooks/use-countdown";
import { useTheme } from "@/hooks/use-theme";
import { PendingOrderDetails } from "../types/order";
import { formatCountdown, formatPrice } from "../utils/format";

// Une réservation pas encore payée. Les places sont bloquées le temps du décompte ; à zéro, elles sont rendues à la vente.
export function PendingOrderCard({ details }: { details: PendingOrderDetails }) {
  const theme = useTheme();
  const { order, event, lines, total } = details;
  const remaining = useCountdown(order.expiresAt);
  const expired = remaining === 0;
  const urgent = !expired && remaining < 3 * 60 * 1000; // moins de 3 minutes : on le fait ressortir

  return (
    <Card padding={16}>
      <View style={styles.top}>
        <View style={styles.titleBlock}>
          <AppText variant="h3" numberOfLines={2}>
            {event.name}
          </AppText>
          <AppText variant="small" color="textSecondary">
            {lines.map((line) => `${line.quantity} × ${line.ticketType.name}`).join(" · ")}
          </AppText>
        </View>
        <AppText variant="h3" color="primary">
          {formatPrice(total, event.currency)}
        </AppText>
      </View>

      <View style={[styles.timer, { backgroundColor: expired ? theme.dangerSoft : urgent ? theme.warningSoft : theme.infoSoft }]}>
        <Icon name="timer" size={18} color={expired ? "danger" : urgent ? "warning" : "info"} />
        <AppText variant="smallStrong" color={expired ? "danger" : urgent ? "warning" : "info"} style={styles.timerText}>
          {expired ? "Réservation expirée : les places ont été rendues." : "Places bloquées pendant"}
        </AppText>
        {!expired && (
          <AppText variant="h3" color={urgent ? "warning" : "info"} style={styles.countdown} accessibilityLabel={`Il reste ${formatCountdown(remaining)}`}>
            {formatCountdown(remaining)}
          </AppText>
        )}
      </View>

      <View style={styles.bottom}>
        <Badge label={order.paymentMethod === "card" ? "Paiement par carte" : "Paiement par virement"} tone="neutral" icon="money" />
        <Button
          title="Voir l'événement"
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={() => router.push({ pathname: "/event/[id]", params: { id: event.id } })}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },

  titleBlock: {
    flex: 1,
    gap: 2,
  },

  timer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },

  timerText: {
    flex: 1,
  },

  countdown: {
    fontVariant: ["tabular-nums"],
  },

  bottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 14,
  },
});
