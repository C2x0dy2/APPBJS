import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Rien à surveiller : on a seulement besoin de savoir si on est côté navigateur ou non.
const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * useSyncExternalStore répond "false" pendant le rendu statique et l'hydratation, puis "true" dans le navigateur
 * (même effet que l'ancien useEffect + setState, sans le rendu supplémentaire que le lint signalait).
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
