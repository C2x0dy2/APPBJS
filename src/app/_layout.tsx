import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/context/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    // AuthProvider englobe tout : n'importe quel écran peut savoir qui est connecté.
    <AuthProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <RootNavigator />
      </ThemeProvider>
    </AuthProvider>
  );
}

// Séparé de RootLayout car useAuth() doit être appelé À L'INTÉRIEUR de <AuthProvider>.
function RootNavigator() {
  const { user } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Stack.Protected : un écran n'existe que si "guard" est vrai.
          Si on n'y a plus droit, on est renvoyé vers le premier écran autorisé. */}
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" />
      </Stack.Protected>

      <Stack.Protected guard={user?.role === 'buyer'}>
        <Stack.Screen name="(buyer)" />
      </Stack.Protected>

      <Stack.Protected guard={user?.role === 'organizer'}>
        <Stack.Screen name="organizer" />
      </Stack.Protected>
    </Stack>
  );
}
