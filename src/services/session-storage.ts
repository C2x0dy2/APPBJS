import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Où le jeton de connexion est gardé, pour que la personne reste connectée quand elle ferme l'application.
//   - Téléphone : le trousseau sécurisé de l'appareil (Keychain sur iOS, Keystore sur Android), jamais un fichier lisible.
//   - Web : le navigateur n'a pas de trousseau, on utilise localStorage (la limite : un script malveillant de la page pourrait le
//     lire, d'où l'importance de ne jamais afficher de contenu HTML venant d'ailleurs).
// Le jeton est aussi gardé en mémoire : on ne relit pas le stockage à chaque requête.
const KEY = "fosse.session-token"; // SecureStore n'accepte que lettres, chiffres, « . », « - » et « _ »

let cached: string | null | undefined; // undefined = pas encore lu

async function readStored(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return window.localStorage.getItem(KEY);
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null; // stockage indisponible (navigation privée, trousseau verrouillé…) : on se comporte comme déconnecté
  }
}

export async function getToken(): Promise<string | null> {
  if (cached === undefined) cached = await readStored();
  return cached;
}

export async function saveToken(token: string): Promise<void> {
  cached = token;
  try {
    if (Platform.OS === "web") window.localStorage.setItem(KEY, token);
    else await SecureStore.setItemAsync(KEY, token);
  } catch {
    // Impossible de le garder : la session dure seulement jusqu'à la fermeture de l'application.
  }
}

export async function clearToken(): Promise<void> {
  cached = null;
  try {
    if (Platform.OS === "web") window.localStorage.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Rien de plus à faire : la copie en mémoire est déjà effacée.
  }
}
