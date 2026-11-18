import { Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// L'échelle typographique de l'app : on choisit une variante, jamais une taille au hasard.
const VARIANTS = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: 800, letterSpacing: -0.8 },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: 800, letterSpacing: -0.5 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: 700, letterSpacing: -0.3 },
  h3: { fontSize: 17, lineHeight: 24, fontWeight: 700, letterSpacing: -0.1 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: 400 },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: 600 },
  small: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  smallStrong: { fontSize: 14, lineHeight: 20, fontWeight: 600 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: 600, letterSpacing: 0.2 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' },
  mono: { fontFamily: Fonts.mono, fontSize: 14, lineHeight: 20, fontWeight: 500, letterSpacing: 1 },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof VARIANTS;

type AppTextProps = TextProps & {
  variant?: TextVariant;
  // Un nom de couleur du thème ("textSecondary"...) ou directement une couleur.
  color?: ThemeColor | (string & {});
};

export function AppText({ variant = 'body', color = 'text', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  const resolved = color in theme ? theme[color as ThemeColor] : color;

  return <Text style={[VARIANTS[variant], { color: resolved }, style]} {...rest} />;
}
