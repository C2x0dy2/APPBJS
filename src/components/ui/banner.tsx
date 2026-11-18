import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type BannerProps = {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode; // le message
  icon?: IconName;
  action?: ReactNode; // ex. un bouton "Renvoyer le lien"
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_ICONS: Record<NonNullable<BannerProps['tone']>, IconName> = {
  info: 'info',
  success: 'checkCircle',
  warning: 'warning',
  danger: 'error',
};

// Un message encadré, à l'intérieur d'un écran : information, succès, avertissement ou erreur.
export function Banner({ tone = 'info', title, children, icon, action, style }: BannerProps) {
  const theme = useTheme();

  const colors = {
    info: { bg: theme.infoSoft, fg: theme.info },
    success: { bg: theme.successSoft, fg: theme.success },
    warning: { bg: theme.warningSoft, fg: theme.warning },
    danger: { bg: theme.dangerSoft, fg: theme.danger },
  }[tone];

  return (
    <View
      style={[styles.banner, { backgroundColor: colors.bg }, style]}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? DEFAULT_ICONS[tone]} size={20} color={colors.fg} style={styles.icon} />
      <View style={styles.body}>
        {title && (
          <AppText variant="smallStrong" color={colors.fg}>
            {title}
          </AppText>
        )}
        {children && (
          <AppText variant="small" color={colors.fg}>
            {children}
          </AppText>
        )}
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: Radius.md,
  },
  icon: {
    marginTop: 1,
  },
  body: {
    flex: 1,
    gap: 2,
  },
});
