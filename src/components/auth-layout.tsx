import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui/app-text";
import { Logo } from "@/components/ui/logo";
import { BRAND } from "@/constants/brand";
import { ContentWidth, Gradients, Radius } from "@/constants/theme";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { useTheme } from "@/hooks/use-theme";

type AuthLayoutProps = {
  title: string;
  subtitle: string;
  children: ReactNode; // le formulaire
};

// Le cadre des écrans de connexion, d'inscription et de mot de passe oublié.
//   - Grand écran : à gauche un panneau de marque, à droite le formulaire.
//   - Téléphone : un bandeau en dégradé avec le titre, et le formulaire dans une feuille blanche qui remonte dessus.
export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isWide } = useBreakpoint();

  if (isWide) {
    return (
      <View style={styles.split}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandPanel}>
          <View style={[styles.circle, styles.circleTop]} />
          <View style={[styles.circle, styles.circleBottom]} />
          <Logo size={44} color="#FFFFFF" />
          <View style={styles.brandCopy}>
            <AppText variant="display" color="#FFFFFF" style={styles.brandTitle}>
              {BRAND.tagline}
            </AppText>
          </View>
        </LinearGradient>

        <ScrollView
          style={[styles.formSide, { backgroundColor: theme.background }]}
          contentContainerStyle={styles.formSideContent}
          keyboardShouldPersistTaps="handled">
          <View style={styles.formBox}>
            <AppText variant="h1">{title}</AppText>
            <AppText variant="body" color="textSecondary" style={styles.wideSubtitle}>
              {subtitle}
            </AppText>
            {children}
          </View>
        </ScrollView>
      </View>
    );
  }

  const top = Platform.OS === "web" ? 24 : insets.top + 16;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.mobileContent}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.banner, { paddingTop: top }]}>
        <View style={[styles.circle, styles.circleTop]} />
        <Logo size={36} color="#FFFFFF" />
        <AppText variant="h1" color="#FFFFFF" style={styles.bannerTitle}>
          {title}
        </AppText>
        <AppText variant="body" color="rgba(255, 255, 255, 0.88)">
          {subtitle}
        </AppText>
      </LinearGradient>

      <View style={[styles.sheet, { backgroundColor: theme.background }]}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // --- grand écran ---
  split: {
    flex: 1,
    flexDirection: "row",
  },
  brandPanel: {
    flex: 1,
    justifyContent: "space-between",
    padding: 48,
    overflow: "hidden",
  },
  brandCopy: {
    gap: 18,
    maxWidth: 520,
  },
  brandTitle: {
    fontSize: 48,
    lineHeight: 54,
  },
  formSide: {
    flex: 1,
  },
  formSideContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 40,
  },
  formBox: {
    width: "100%",
    maxWidth: ContentWidth.form,
    alignSelf: "center",
  },
  wideSubtitle: {
    marginTop: 6,
    marginBottom: 28,
  },

  // --- téléphone ---
  mobileContent: {
    flexGrow: 1,
  },
  banner: {
    paddingHorizontal: 24,
    paddingBottom: 56,
    gap: 6,
    overflow: "hidden",
  },
  bannerTitle: {
    marginTop: 22,
  },
  sheet: {
    flex: 1,
    marginTop: -28,
    padding: 24,
    paddingBottom: 40,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },

  // --- décor commun ---
  circle: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  circleTop: {
    width: 260,
    height: 260,
    right: -80,
    top: -90,
  },
  circleBottom: {
    width: 380,
    height: 380,
    left: -140,
    bottom: -160,
  },
});
