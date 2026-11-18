import { supabase } from "../lib/supabase";

// Supabase garde lui-même la session sur l'appareil (voir lib/supabase.ts : AsyncStorage + autoRefreshToken) —
// se connecter, s'inscrire ou se déconnecter la persiste ou l'efface automatiquement. Ce fichier n'expose plus
// qu'une lecture, pour le lancement de l'application (context/auth.tsx) : y a-t-il déjà quelqu'un de connecté ?
export async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
