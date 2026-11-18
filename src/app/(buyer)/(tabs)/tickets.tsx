import { router } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { SignInPrompt } from "@/components/sign-in-prompt";
import { TicketCard } from "@/components/ticket-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen, ScreenHeader } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { ContentWidth } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useLoad } from "@/hooks/use-load";
import { getMyTickets } from "@/services/ticketservices";
import { TicketDetails } from "@/types/order";
import { daysUntil } from "@/utils/format";
import { chunk } from "@/utils/list";

type Tab = "upcoming" | "past";

// Un billet est "à venir" tant qu'il est valide et que l'événement n'est pas passé.
function isUpcoming(details: TicketDetails): boolean {
  return details.ticket.status === "valid" && daysUntil(details.event.date) >= 0;
}

export default function TicketsScreen() {
  const { user } = useAuth();
  const { columns } = useBreakpoint();
  const [tab, setTab] = useState<Tab>("upcoming");

  // Les billets de la personne connectée, relus à chaque retour sur l'écran (par exemple après avoir consulté un billet).
  const load = useCallback(() => getMyTickets(), []);
  const { data, error, loading, reload } = useLoad(load, user !== null);
  const tickets = data ?? [];

  if (!user) {
    return (
      <Screen>
        <SignInPrompt icon="ticket" title="Retrouve tes billets" message="Connecte-toi pour afficher tes billets et leurs QR codes." />
      </Screen>
    );
  }

  const upcoming = tickets.filter(isUpcoming);
  // Les billets passés : le plus récent d'abord.
  const past = tickets.filter((details) => !isUpcoming(details)).reverse();
  const shown = tab === "upcoming" ? upcoming : past;
  const rows = chunk(shown, columns);

  return (
    <Screen maxWidth={ContentWidth.wide}>
      <ScreenHeader
        title="Mes billets"
        subtitle={upcoming.length === 0 ? undefined : `${upcoming.length} billet${upcoming.length > 1 ? "s" : ""} à venir`}
      />

      <Segmented
        options={[
          { value: "upcoming", label: `À venir (${upcoming.length})` },
          { value: "past", label: `Passés (${past.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      <View style={styles.list}>
        {loading && <LoadingState />}
        {data === undefined && error ? <ErrorState error={error} onRetry={reload} /> : null}
        {rows.map((row) => (
          <View key={row.map((details) => details.ticket.id).join("-")} style={styles.row}>
            {row.map((details) => (
              <View key={details.ticket.id} style={styles.cell}>
                <TicketCard details={details} href={{ pathname: "/ticket/[id]", params: { id: details.ticket.id } }} />
              </View>
            ))}
            {Array.from({ length: columns - row.length }, (_, index) => (
              <View key={`empty-${index}`} style={styles.cell} />
            ))}
          </View>
        ))}

        {data !== undefined && shown.length === 0 &&
          (tab === "upcoming" ? (
            <EmptyState
              icon="ticket"
              title="Aucun billet à venir"
              message="Tes billets apparaîtront ici après un achat."
              actionLabel="Découvrir les événements"
              onAction={() => router.push("/")}
            />
          ) : (
            <EmptyState icon="hourglass" title="Aucun billet passé" message="Les billets des événements terminés se retrouveront ici." />
          ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: 20,
  },

  row: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 16,
  },

  cell: {
    flex: 1,
  },
});
