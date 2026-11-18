import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  // Sur une image ou un dégradé : fond blanc plein, pour rester lisible.
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Une petite pastille d'information : "En vente", "Complet", "Valide"...
export function Badge({ label, tone = 'neutral', icon, solid = false, style }: BadgeProps) {
  const theme = useTheme();

  const colors = {
    neutral: { bg: theme.backgroundElement, fg: theme.textSecondary },
    brand: { bg: theme.primarySoft, fg: theme.primary },
    success: { bg: theme.successSoft, fg: theme.success },
    warning: { bg: theme.warningSoft, fg: theme.warning },
    danger: { bg: theme.dangerSoft, fg: theme.danger },
    info: { bg: theme.infoSoft, fg: theme.info },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: solid ? '#FFFFFF' : colors.bg }, style]}>
      {icon && <Icon name={icon} size={13} color={colors.fg} />}
      <AppText variant="caption" color={colors.fg} style={styles.label}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: Radius.pill,
  },
  label: {
    fontWeight: 700,
  },
});
