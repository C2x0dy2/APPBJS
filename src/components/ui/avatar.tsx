import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Gradients } from '@/constants/theme';

// Un rond avec l'initiale de la personne.
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <LinearGradient
      colors={Gradients.brand}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityLabel={`Avatar de ${name}`}>
      <AppText variant="bodyStrong" color="#FFFFFF" style={{ fontSize: size * 0.42, lineHeight: size * 0.5 }}>
        {initial}
      </AppText>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
