import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { Screen } from '@/components/ui/screen';
import { ErrorState } from '@/components/ui/state';
import { BRAND } from '@/constants/brand';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/context/auth';
import { SiteProvider } from '@/context/site';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = Colors[colorScheme === 'dark' ? 'dark' : 'light'];

  // La navigation (fond des écrans, barres, traits) reprend les couleurs de l'app.
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    // AuthProvider englobe tout : n'importe quel écran peut savoir qui est connecté.
    // SiteProvider vient après : il lit les réglages du site une fois le lancement terminé.
    <AuthProvider>
      <SiteProvider>
        {/* Le titre de l'onglet du navigateur (sans cela, le routeur en ajoute un vide qui masque celui de la page). */}
        <Head>
          <title>{`${BRAND.name} – ${BRAND.tagline}`}</title>
        </Head>
        <ThemeProvider value={navigationTheme}>
          <Launch />
          <RootNavigator backgroundColor={colors.background} spinnerColor={colors.primary} />
        </ThemeProvider>
      </SiteProvider>
    </AuthProvider>
  );
}

// L'écran de lancement reste affiché tant qu'on ne sait pas qui est connecté.
function Launch() {
  const { status } = useAuth();
  return <AnimatedSplashOverlay ready={status !== 'loading'} />;
}

// Séparé de RootLayout car useAuth() doit être appelé À L'INTÉRIEUR de <AuthProvider>.
function RootNavigator({ backgroundColor, spinnerColor }: { backgroundColor: string; spinnerColor: string }) {
  const { user, status, startupError, retryStartup } = useAuth();

  // On retrouve la session (le jeton gardé sur l'appareil) : sans cela, un organisateur verrait un instant l'espace acheteur.
  if (status === 'loading') {
    return (
      <View style={[styles.loading, { backgroundColor }]}>
        <ActivityIndicator color={spinnerColor} />
      </View>
    );
  }

  // Tout vient du serveur : s'il ne répond pas au lancement, il n'y a rien à montrer, on propose de réessayer.
  if (status === 'unreachable') {
    return (
      <Screen>
        <ErrorState title="Serveur injoignable" error={startupError} onRetry={retryStartup} />
      </Screen>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Stack.Protected : un écran n'existe que si "guard" est vrai.
          Si on n'y a plus droit, on est renvoyé vers le premier écran autorisé. */}

      {/* L'espace acheteur est ouvert à tous : visiteurs sans compte comme acheteurs connectés. */}
      <Stack.Protected guard={user?.role !== 'organizer'}>
        <Stack.Screen name="(buyer)" />
      </Stack.Protected>

      <Stack.Protected guard={user?.role === 'organizer'}>
        <Stack.Screen name="organizer" />
      </Stack.Protected>

      {/* Connexion, inscription, mot de passe oublié, liens reçus par e-mail, pages légales : accessibles à tout moment
          (déclarés en dernier, pour que le premier écran autorisé reste toujours l'espace acheteur ou organisateur). */}
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="verify-email/[token]" />
      <Stack.Screen name="reset-password/[uid]/[token]" />
      <Stack.Screen name="legal/[slug]" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
