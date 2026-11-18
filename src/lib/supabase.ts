import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project values."
  );
}

// On web, Expo Router server-renders screens in Node (no `window`) before hydrating in the
// browser. AsyncStorage's web shim touches `window.localStorage` unconditionally, so session
// persistence must stay off during that server pass or the render crashes.
const isBrowser = typeof window !== "undefined";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isBrowser ? AsyncStorage : undefined,
    autoRefreshToken: isBrowser,
    persistSession: isBrowser,
    // Les liens de vérification d'e-mail et de mot de passe oublié ramènent sur le site avec un
    // jeton dans l'URL : Supabase doit le détecter lui-même pour ouvrir la session correspondante.
    detectSessionInUrl: isBrowser,
  },
});
