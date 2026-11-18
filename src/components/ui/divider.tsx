import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useTheme } from '@/hooks/use-theme';

// Un trait de séparation, avec un mot au milieu si on en donne un ("ou").
export function Divider({ label }: { label?: string }) {
  const theme = useTheme();
  const line = <View style={[styles.line, { backgroundColor: theme.border }]} />;

  return (
    <View style={styles.row}>
      {line}
      {label && (
        <AppText variant="caption" color="textTertiary" style={styles.label}>
          {label}
        </AppText>
      )}
      {label && line}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 20,
  },
  line: {
    flex: 1,
    height: 1,
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
