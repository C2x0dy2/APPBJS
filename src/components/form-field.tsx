import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";

// Un champ = un titre + une zone de saisie + un message d'erreur éventuel.
// On l'écrit une fois ici et on le réutilise partout (création, modification...).
// "style" s'applique au bloc entier (ex. largeur), pas à la zone de saisie.
type FormFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  error?: string;
  style?: StyleProp<ViewStyle>;
};

export function FormField({ label, error, style, ...inputProps }: FormFieldProps) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        placeholderTextColor="#999"
        {...inputProps} // value, onChangeText, placeholder, keyboardType... passés tels quels
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: 14,
  },

  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff",
    color: "#000",
  },

  inputError: {
    borderColor: "#c62828",
  },

  error: {
    color: "#c62828",
    fontSize: 13,
    marginTop: 4,
  },
});
