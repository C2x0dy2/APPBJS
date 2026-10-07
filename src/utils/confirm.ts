import { Alert, Platform } from "react-native";

// Demande "Tu es sûr ?" avant une action grave (annuler, supprimer).
// Alert.alert ne fonctionne pas dans un navigateur, d'où le cas web avec window.confirm.
export function confirmAction(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Retour", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) } // Android : tap à côté = non
    );
  });
}
