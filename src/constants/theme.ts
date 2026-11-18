/**
 * Thème de l'app : couleurs (clair et sombre), rayons, ombres, dégradés, polices.
 * L'identité reprend celle du site Fosse : violet profond, rose du logo, jaune d'accent.
 * Une couleur se lit toujours via useTheme() : jamais de "#xxxxxx" écrit directement dans un écran.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // --- déjà présents dans le modèle de départ (utilisés par ThemedText, ThemedView, les onglets) ---
    text: '#1D0B33',
    background: '#FAF8FC',
    backgroundElement: '#F1ECF7',
    backgroundSelected: '#E6DDF1',
    textSecondary: '#675A75',
    // --- ajoutés pour l'interface ---
    textTertiary: '#8E81A0', // placeholders, légendes discrètes
    surface: '#FFFFFF', // cartes, champs
    border: '#E6DFEE',
    borderStrong: '#CDC1DB',
    primary: '#6A1FC9', // violet : liens, éléments actifs
    primarySoft: '#F0E7FB',
    accent: '#D6168A', // rose du logo
    accentSoft: '#FDE7F3',
    onPrimary: '#FFFFFF', // texte sur fond coloré
    success: '#157A44',
    successSoft: '#E3F5EA',
    warning: '#A85A00',
    warningSoft: '#FFF0D8',
    danger: '#C42B23',
    dangerSoft: '#FCE7E5',
    info: '#2553C9',
    infoSoft: '#E7EDFB',
    overlay: 'rgba(18, 4, 31, 0.55)',
  },
  dark: {
    text: '#F6F1FB',
    background: '#12041F',
    backgroundElement: '#220D38',
    backgroundSelected: '#2F1650',
    textSecondary: '#B7A9C8',
    textTertiary: '#8A7B9D',
    surface: '#1B0B2E',
    border: '#35214F',
    borderStrong: '#4B3469',
    primary: '#B58CFF',
    primarySoft: '#2E1650',
    accent: '#FF5CB8',
    accentSoft: '#3A1230',
    onPrimary: '#FFFFFF',
    success: '#4CD18A',
    successSoft: '#10301F',
    warning: '#F5B04D',
    warningSoft: '#33220A',
    danger: '#FF7A70',
    dangerSoft: '#3B1512',
    info: '#7FA2FF',
    infoSoft: '#14213F',
    overlay: 'rgba(0, 0, 0, 0.65)',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

// Arrondis : plus ils sont grands, plus l'élément est "doux". pill = bouts totalement ronds.
export const Radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

// Ombres (propriété boxShadow : identique sur iOS, Android et web).
export const Shadow = {
  card: '0 1px 2px rgba(29, 11, 51, 0.05), 0 8px 24px rgba(29, 11, 51, 0.07)',
  raised: '0 2px 6px rgba(29, 11, 51, 0.08), 0 16px 40px rgba(29, 11, 51, 0.16)',
  brand: '0 8px 20px rgba(214, 22, 138, 0.28)', // halo rose sous le bouton principal
} as const;

// Dégradés : le premier est celui des boutons, le deuxième celui du logo.
export const Gradients = {
  brand: ['#D6168A', '#6A1FC9'],
  logo: ['#FF4FB0', '#4B0F7A'],
  night: ['#12041F', '#35106A'],
} as const;

// Pochettes d'événements : l'API ne fournit pas encore d'image, chaque événement reçoit donc
// un dégradé stable (toujours le même pour un même événement) choisi dans cette liste.
export const CoverPalettes = [
  ['#FF4FB0', '#6A1FC9'],
  ['#6A1FC9', '#2553C9'],
  ['#E98A1E', '#C4126B'],
  ['#157A44', '#2553C9'],
  ['#35106A', '#D6168A'],
  ['#12041F', '#6A1FC9'],
] as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

// Largeur maximale du contenu sur grand écran (le contenu reste centré, jamais étiré).
export const ContentWidth = {
  form: 480, // connexion, inscription, formulaires
  content: 960, // listes, détails
  wide: 1120, // tableaux de bord
} as const;
