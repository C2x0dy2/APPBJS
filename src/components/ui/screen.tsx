import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { ContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Marge horizontale commune à tous les écrans.
export const SCREEN_PADDING = 20;

type ScreenProps = {
  children: ReactNode;
  // true : le contenu défile (ScrollView). false : l'écran gère son défilement lui-même (ex. FlatList).
  scroll?: boolean;
  // Largeur maximale du contenu : sur grand écran il reste centré au lieu de s'étirer.
  maxWidth?: number;
  // Évite le bandeau du téléphone (heure, batterie). À désactiver si une barre de titre native est déjà affichée
  // ou si l'écran commence par une image qui passe sous le bandeau.
  topInset?: boolean;
  // false : pas de marge sur les côtés ni en haut ; l'écran gère lui-même ses marges (ex. pochette plein écran).
  padded?: boolean;
  // Zone fixe en bas de l'écran (ex. le bouton "Réserver").
  footer?: ReactNode;
  refreshControl?: ScrollViewProps['refreshControl'];
  contentContainerStyle?: StyleProp<ViewStyle>;
};

// Le cadre de chaque écran : fond du thème, zone sûre du téléphone, contenu centré et limité en largeur.
export function Screen({
  children,
  scroll = true,
  maxWidth = ContentWidth.content,
  topInset = true,
  padded = true,
  footer,
  refreshControl,
  contentContainerStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Sur le web, la barre de navigation fait déjà partie de la page : pas de zone sûre à ajouter.
  const paddingTop = Platform.OS === 'web' || !topInset ? 0 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingTop }]}>
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[padded ? styles.scrollContent : styles.scrollContentFlush, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}>
          <View style={[styles.inner, { maxWidth }]}>{children}</View>
        </ScrollView>
      ) : (
        <View style={styles.root}>
          <View style={[styles.inner, styles.fill, { maxWidth }]}>{children}</View>
        </View>
      )}
      {footer}
    </View>
  );
}

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  right?: ReactNode; // ex. un bouton "Créer"
};

// Le titre d'une page, avec un sous-titre et une action facultatifs.
export function ScreenHeader({ title, subtitle, right }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <AppText variant="h1" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle && (
          <AppText variant="body" color="textSecondary" style={styles.subtitle}>
            {subtitle}
          </AppText>
        )}
      </View>
      {right}
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Le titre d'une section de page ("Prochains événements"), avec un lien à droite si besoin.
export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="h2" accessibilityRole="header">
        {title}
      </AppText>
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="link">
          <AppText variant="smallStrong" color="primary">
            {actionLabel}
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: 12,
    paddingBottom: 40,
  },
  scrollContentFlush: {
    paddingBottom: 24,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
  },
  fill: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },
  headerText: {
    flex: 1,
  },
  subtitle: {
    marginTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 14,
  },
});
