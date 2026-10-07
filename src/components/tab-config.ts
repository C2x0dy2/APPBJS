import type { Href } from 'expo-router';
import type { MaterialIcon, SFSymbolIcon } from 'expo-router/unstable-native-tabs';

// La description d'un onglet, commune au mobile (app-tabs.tsx) et au web (app-tabs.web.tsx).
export interface TabConfig {
  name: string; // nom du fichier de l'écran dans le dossier (tabs)
  href: Href; // adresse de l'écran (utilisée par la version web)
  label: string;
  sf: SFSymbolIcon['sf']; // icône iOS (SF Symbols)
  md: MaterialIcon['md']; // icône Android (Material Symbols)
}
