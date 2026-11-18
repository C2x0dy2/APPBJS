import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { useTheme } from '@/hooks/use-theme';

type EmptyStateProps = {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

// Quand il n'y a rien à montrer : on explique pourquoi et on propose quoi faire.
export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.circle, { backgroundColor: theme.primarySoft }]}>
        <Icon name={icon} size={32} color="primary" />
      </View>
      <AppText variant="h3" style={styles.title}>
        {title}
      </AppText>
      {message && (
        <AppText variant="small" color="textSecondary" style={styles.message}>
          {message}
        </AppText>
      )}
      {actionLabel && onAction && <Button title={actionLabel} onPress={onAction} size="md" fullWidth={false} style={styles.action} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  circle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
  },
  action: {
    marginTop: 20,
    alignSelf: 'center', // le bouton à largeur automatique se colle à gauche par défaut : on le recentre
  },
});
