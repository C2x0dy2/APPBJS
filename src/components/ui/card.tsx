import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Shadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CardProps = {
  children: ReactNode;
  padding?: number;
  // false : carte "à plat" (juste un contour), pour les listes denses.
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Le bloc de base de l'interface : un fond clair, des coins arrondis, une ombre légère.
export function Card({ children, padding = 16, elevated = true, style }: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, padding },
        elevated && { boxShadow: Shadow.card },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
});
