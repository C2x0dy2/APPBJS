import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Keyframe } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { LogoMark } from '@/components/ui/logo';

const DURATION = 600;

// Mêmes valeurs que le plugin expo-splash-screen (app.json) : l'écran de lancement natif et cette animation
// se superposent exactement, on ne voit aucun saut entre les deux.
const SPLASH_BACKGROUND = '#12041F';
const LOGO_SIZE = 200;

// L'écran de lancement : le logo Fosse sur fond sombre, qui s'efface pour laisser place à l'app.
// `ready` : l'app a fini de se préparer (par exemple retrouver la personne connectée). Tant qu'il vaut false, l'écran de
// lancement reste affiché : on ne montre jamais un écran qui changerait aussitôt après.
export function AnimatedSplashOverlay({ ready = true }: { ready?: boolean }) {
  const [laidOut, setLaidOut] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  // L'app est prête : on retire l'écran de lancement natif, puis on lance le fondu.
  useEffect(() => {
    if (!ready || !laidOut) return;
    SplashScreen.hideAsync().finally(() => {
      setAnimate(true);
    });
  }, [ready, laidOut]);

  if (!visible) return null;

  const content = (
    <View style={styles.logo}>
      <LogoMark size={LOGO_SIZE} />
    </View>
  );

  return animate ? (
    <Animated.View
      entering={fadeOut.duration(DURATION).withCallback((finished) => {
        'worklet';
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.overlay}>
      {content}
    </Animated.View>
  ) : (
    <View onLayout={() => setLaidOut(true)} style={styles.overlay}>
      {content}
    </View>
  );
}

const fadeOut = new Keyframe({
  0: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
  25: {
    opacity: 1,
  },
  100: {
    opacity: 0,
    transform: [{ scale: 1.12 }],
    easing: Easing.out(Easing.quad),
  },
});

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SPLASH_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
