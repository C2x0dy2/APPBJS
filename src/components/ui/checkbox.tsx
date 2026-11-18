import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Icon } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode; // le texte à côté de la case
  error?: string;
};

// Une case à cocher : tout le texte est cliquable, pas seulement la case.
export function Checkbox({ checked, onChange, children, error }: CheckboxProps) {
  const theme = useTheme();

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={styles.row}>
        <View
          style={[
            styles.box,
            checked
              ? { backgroundColor: theme.primary, borderColor: theme.primary }
              : { backgroundColor: theme.surface, borderColor: error ? theme.danger : theme.borderStrong },
          ]}>
          {checked && <Icon name="check" size={16} color={theme.onPrimary} />}
        </View>
        <AppText variant="small" style={styles.label}>
          {children}
        </AppText>
      </Pressable>
      {error ? (
        <AppText variant="caption" color="danger" style={styles.error}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  label: {
    flex: 1,
  },
  error: {
    marginTop: 6,
    marginLeft: 36,
  },
});
