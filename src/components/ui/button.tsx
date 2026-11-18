import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Gradients, Radius, Shadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ButtonProps = {
  title: string;
  onPress?: () => void;
  // primary : l'action principale de l'écran (dégradé). secondary : action secondaire. ghost : texte seul. danger : action destructive.
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  // true (par défaut) : le bouton prend toute la largeur. false : seulement la largeur de son texte.
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const HEIGHTS = { sm: 40, md: 48, lg: 54 } as const;

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const height = HEIGHTS[size];

  const textColor = {
    primary: theme.onPrimary,
    secondary: theme.text,
    ghost: theme.primary,
    danger: theme.danger,
  }[variant];

  const surface: ViewStyle =
    variant === 'secondary'
      ? { backgroundColor: theme.surface, borderWidth: 1.5, borderColor: theme.border }
      : variant === 'danger'
        ? { backgroundColor: theme.dangerSoft }
        : {};

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={(state) => {
        // "hovered" n'existe que sur le web (survol à la souris).
        const hovered = (state as { hovered?: boolean }).hovered;
        return [
          styles.base,
          { height, borderRadius: size === 'sm' ? Radius.sm : Radius.md },
          fullWidth ? styles.fullWidth : styles.autoWidth,
          surface,
          variant === 'primary' && { boxShadow: Shadow.brand },
          variant === 'ghost' && hovered && { backgroundColor: theme.primarySoft },
          inactive && styles.inactive,
          state.pressed && styles.pressed,
          hovered && !state.pressed && styles.hovered,
          style,
        ];
      }}>
      {variant === 'primary' && (
        <LinearGradient
          colors={Gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: size === 'sm' ? Radius.sm : Radius.md }]}
        />
      )}

      <View style={[styles.content, { paddingHorizontal: size === 'sm' ? 14 : 20 }]}>
        {loading ? (
          <ActivityIndicator size="small" color={textColor} />
        ) : (
          icon && <Icon name={icon} size={size === 'sm' ? 16 : 20} color={textColor} />
        )}
        <AppText variant={size === 'sm' ? 'smallStrong' : 'bodyStrong'} color={textColor} numberOfLines={1}>
          {title}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    justifyContent: 'center',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  autoWidth: {
    alignSelf: 'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inactive: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  hovered: {
    opacity: 0.94,
  },
});
