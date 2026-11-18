import { useState, type ReactNode, type Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type InputProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string;
  hint?: string; // aide discrète sous le champ (masquée quand il y a une erreur)
  icon?: IconName; // icône à gauche
  right?: ReactNode; // élément à droite (ex. un bouton)
  containerStyle?: StyleProp<ViewStyle>; // style du bloc entier (largeur, marges)
  inputRef?: Ref<TextInput>; // pour passer au champ suivant au clavier
};

// Un champ = un titre + une zone de saisie + un message d'erreur éventuel.
// Avec secureTextEntry, un bouton "œil" apparaît pour afficher / masquer le mot de passe.
export function Input({
  label,
  error,
  hint,
  icon,
  right,
  containerStyle,
  inputRef,
  secureTextEntry,
  onFocus,
  onBlur,
  ...inputProps
}: InputProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error ? theme.danger : focused ? theme.primary : theme.border;

  return (
    <View style={[styles.block, containerStyle]}>
      {label && (
        <AppText variant="smallStrong" style={styles.label}>
          {label}
        </AppText>
      )}

      <View
        style={[
          styles.field,
          { backgroundColor: theme.surface, borderColor },
          focused && { boxShadow: `0 0 0 4px ${error ? theme.dangerSoft : theme.primarySoft}` },
        ]}>
        {icon && <Icon name={icon} size={20} color={focused ? 'primary' : 'textTertiary'} />}

        <TextInput
          ref={inputRef}
          style={[styles.input, { color: theme.text }]}
          placeholderTextColor={theme.textTertiary}
          accessibilityLabel={label}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...inputProps}
        />

        {secureTextEntry && (
          <Pressable
            onPress={() => setRevealed(!revealed)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={20} color="textSecondary" />
          </Pressable>
        )}
        {right}
      </View>

      {error ? (
        <View style={styles.messageRow} accessibilityLiveRegion="polite">
          <Icon name="error" size={14} color="danger" />
          <AppText variant="caption" color="danger" style={styles.message}>
            {error}
          </AppText>
        </View>
      ) : hint ? (
        <AppText variant="caption" color="textSecondary" style={styles.hint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: Radius.md,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    outlineWidth: 0, // pas de cadre noir du navigateur : le contour violet fait office de focus
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  message: {
    flex: 1,
  },
  hint: {
    marginTop: 6,
  },
});
