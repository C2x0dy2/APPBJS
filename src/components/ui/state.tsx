import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { useTheme } from '@/hooks/use-theme';
import type { LoadState } from '@/hooks/use-load';
import { errorMessage } from '@/services/api';

// Les deux états que tout écran doit prévoir en plus de « il y a des données » : on attend le serveur, ou il a échoué.

export function LoadingState() {
  const theme = useTheme();

  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel="Chargement">
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

// L'erreur est expliquée en clair (réseau coupé, serveur en panne…), avec un bouton pour recommencer.
export function ErrorState({ error, onRetry, title = 'Chargement impossible' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return <EmptyState icon="warning" title={title} message={errorMessage(error)} actionLabel={onRetry ? 'Réessayer' : undefined} onAction={onRetry} />;
}

// Affiche, selon l'état de la lecture : le chargement, l'erreur (avec « Réessayer »), ou le contenu une fois les données arrivées.
//   <LoadBoundary state={state}>{(events) => <Liste events={events} />}</LoadBoundary>
// `data` peut valoir null (« introuvable ») : c'est au contenu de l'expliquer.
export function LoadBoundary<T>({ state, children }: { state: LoadState<T>; children: (data: T) => ReactNode }) {
  if (state.data !== undefined) return <>{children(state.data)}</>;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  return <LoadingState />;
}

const styles = StyleSheet.create({
  center: {
    paddingVertical: 80,
    alignItems: 'center',
  },
});
