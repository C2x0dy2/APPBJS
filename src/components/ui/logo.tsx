import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';

import { AppText } from '@/components/ui/app-text';
import { BRAND } from '@/constants/brand';
import { Gradients } from '@/constants/theme';

// Le logo Fosse : un billet (carré arrondi avec deux encoches sur les côtés) et un "F".
// Même dessin que le logo du site (logo-fosse.svg).
export function LogoMark({ size = 36 }: { size?: number }) {
  // Un identifiant propre à chaque logo : plusieurs logos sur la même page ne se marchent pas dessus.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel={BRAND.name}>
      <Defs>
        <LinearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={Gradients.logo[0]} />
          <Stop offset="1" stopColor={Gradients.logo[1]} />
        </LinearGradient>
        <Mask id={`m${id}`}>
          <Rect width="64" height="64" fill="#fff" />
          <Circle cx="0" cy="32" r="7" fill="#000" />
          <Circle cx="64" cy="32" r="7" fill="#000" />
        </Mask>
      </Defs>
      <Rect width="64" height="64" rx="16" fill={`url(#g${id})`} mask={`url(#m${id})`} />
      <Path fill="#fff" d="M22 16h24v8H30v5h12v8H30v11h-8z" />
    </Svg>
  );
}

// Logo + nom. "color" : couleur du nom (blanc sur un dégradé, texte du thème sinon).
export function Logo({ size = 36, color = 'text', showName = true }: { size?: number; color?: string; showName?: boolean }) {
  return (
    <View style={styles.row} accessibilityRole="header">
      <LogoMark size={size} />
      {showName && (
        <AppText variant="h2" color={color} style={{ fontSize: size * 0.62, lineHeight: size * 0.8, letterSpacing: -0.6 }}>
          {BRAND.name}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
