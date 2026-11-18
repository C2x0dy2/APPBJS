import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Icon, type IconName } from '@/components/ui/icon';
import type { BadgeTone } from '@/components/ui/badge';
import { useTheme } from '@/hooks/use-theme';

type StatTileProps = {
  icon: IconName;
  label: string;
  value: string;
  hint?: string; // petite précision sous la valeur
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
};

// Un chiffre clé : une icône colorée, la valeur en grand, son libellé en dessous.
export function StatTile({ icon, label, value, hint, tone = 'brand', style }: StatTileProps) {
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
    <Card style={[styles.tile, style]} padding={16}>
      <View style={[styles.iconCircle, { backgroundColor: colors.bg }]}>
        <Icon name={icon} size={20} color={colors.fg} />
      </View>
      <AppText variant="h2" style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="small" color="textSecondary" numberOfLines={2}>
        {label}
      </AppText>
      {hint && (
        <AppText variant="caption" color="textTertiary" style={styles.hint}>
          {hint}
        </AppText>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 140,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  value: {
    marginBottom: 2,
  },
  hint: {
    marginTop: 4,
  },
});
