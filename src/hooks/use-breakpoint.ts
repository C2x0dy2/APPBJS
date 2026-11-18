import { useWindowDimensions } from 'react-native';

// Largeur de l'écran -> mise en page. Téléphone : 1 colonne. Tablette : 2. Grand écran (web) : 3.
export const WIDE_BREAKPOINT = 900;

export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return {
    width,
    isWide: width >= WIDE_BREAKPOINT, // web sur ordinateur : barre de navigation en haut
    columns: width >= 1100 ? 3 : width >= 700 ? 2 : 1,
  };
}
