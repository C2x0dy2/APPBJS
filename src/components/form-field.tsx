import { StyleProp, TextInputProps, ViewStyle } from "react-native";

import { Input } from "@/components/ui/input";

// Un champ = un titre + une zone de saisie + un message d'erreur éventuel.
// On l'écrit une fois (components/ui/input.tsx) et on le réutilise partout (création, modification, connexion...).
// "style" s'applique au bloc entier (ex. largeur), pas à la zone de saisie.
type FormFieldProps = Omit<TextInputProps, "style"> & {
  label: string;
  error?: string;
  style?: StyleProp<ViewStyle>;
};

export function FormField({ style, ...inputProps }: FormFieldProps) {
  return <Input containerStyle={style} {...inputProps} />; // value, onChangeText, placeholder, keyboardType... passés tels quels
}
