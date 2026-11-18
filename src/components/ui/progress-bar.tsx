import { StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Segment = { value: number; color: string };

type ProgressBarProps = {
  // Plusieurs segments empilés (ex. vendues + réservées), chacun avec sa couleur.
  segments: Segment[];
  total: number;
  height?: number;
};

// Barre de remplissage : la part de chaque segment par rapport au total.
export function ProgressBar({ segments, total, height = 10 }: ProgressBarProps) {
  const theme = useTheme();

  return (
    <View
      style={[styles.track, { height, backgroundColor: theme.backgroundSelected }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: segments.reduce((sum, s) => sum + s.value, 0) }}>
      {segments.map((segment, index) => (
        <View
          key={index}
          style={{
            width: `${total > 0 ? Math.min((segment.value / total) * 100, 100) : 0}%`,
            backgroundColor: segment.color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
});
