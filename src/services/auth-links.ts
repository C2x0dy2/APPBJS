import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { supabase } from "../lib/supabase";

// Les liens envoyés par e-mail par Supabase (confirmation d'inscription, mot de passe oublié) passent d'abord par le
// serveur Supabase, qui renvoie ensuite vers l'adresse donnée ici, avec la session dans l'adresse
// (#access_token=…&refresh_token=…&type=recovery) ou une erreur (#error_description=…, ex. lien expiré).
//
// - Web : Supabase lit lui-même l'adresse au chargement (detectSessionInUrl, voir lib/supabase.ts).
// - Téléphone : le lien rouvre l'app (billeterie://…) et c'est à nous de lire la session : consumeAuthLink().
//
// Côté Supabase, ces adresses doivent être autorisées : Authentication -> URL Configuration -> Redirect URLs
// (l'adresse du site web suivie de /**, et billeterie://**). Sinon Supabase renvoie vers la « Site URL » par défaut.

// Adresse de retour pour un chemin de l'app : https://site/chemin sur le web, billeterie://chemin sur téléphone.
export function authRedirectUrl(path: string): string {
  return Linking.createURL(path);
}

// Paramètres d'un lien, qu'ils soient après « ? » ou après « # ».
function readParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";
  const queryIndex = beforeHash.indexOf("?");
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "";
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((value, key) => {
      params[key] = value;
    });
  }
  return params;
}

// Message à afficher si le lien est expiré, déjà utilisé ou refusé par Supabase ; undefined sinon.
export function authLinkError(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const params = readParams(url);
  if (!params.error && !params.error_code && !params.error_description) return undefined;
  if (params.error_code === "otp_expired") return "Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau.";
  return "Ce lien n'est pas valide. Demande-en un nouveau.";
}

// L'adresse actuelle de la page (web) ; null ailleurs.
export function currentWebUrl(): string | null {
  return Platform.OS === "web" && typeof window !== "undefined" && window.location ? window.location.href : null;
}

// Le lien « mot de passe oublié » a-t-il été ouvert ? L'écran /reset-password n'accepte un nouveau mot de passe
// QUE dans ce cas : une session ordinaire (quelqu'un de déjà connecté, ou un appareil laissé ouvert) ne suffit pas.
// Web : Supabase émet PASSWORD_RECOVERY en lisant l'adresse au chargement, avant même l'affichage des écrans, d'où
// cette écoute dès le chargement du module. Téléphone : consumeAuthLink() le note lui-même (type=recovery).
let recoveryOpened = false;
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") recoveryOpened = true;
  if (event === "SIGNED_OUT") recoveryOpened = false;
});

// Attend (quelques secondes au plus) que le lien de récupération ait ouvert sa session.
export function waitForRecovery(timeoutMs = 5000): Promise<boolean> {
  if (recoveryOpened) return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(recoveryOpened);
    };
    const timer = setTimeout(finish, timeoutMs);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      if (recoveryOpened) setTimeout(finish, 0);
    });
  });
}

// Le message d'erreur du lien qui a ouvert l'écran (expiré, déjà utilisé…), sur le web comme sur téléphone.
export function useAuthLinkError(): string | undefined {
  const nativeUrl = Linking.useURL();
  return authLinkError(Platform.OS === "web" ? currentWebUrl() : nativeUrl);
}

export type AuthLinkResult = "none" | "session" | "error";

// Téléphone uniquement : ouvre la session contenue dans un lien reçu par e-mail. Sur le web, Supabase le fait seul.
export async function consumeAuthLink(url: string | null): Promise<AuthLinkResult> {
  if (!url || Platform.OS === "web") return "none";
  const params = readParams(url);
  if (authLinkError(url)) return "error";
  if (!params.access_token || !params.refresh_token) return "none";

  // Noté AVANT d'ouvrir la session : waitForRecovery() vérifie ce drapeau dès l'événement de connexion.
  if (params.type === "recovery") recoveryOpened = true;
  const { error } = await supabase.auth.setSession({
    access_token: params.access_token,
    refresh_token: params.refresh_token,
  });
  if (error) {
    recoveryOpened = false;
    return "error";
  }
  return "session";
}

// Au lancement : le lien qui a ouvert l'app, s'il y en a un.
export async function consumeInitialAuthLink(): Promise<AuthLinkResult> {
  if (Platform.OS === "web") return "none";
  return consumeAuthLink(await Linking.getInitialURL());
}

// Ensuite : un lien ouvert pendant que l'app tourne. `onSession` est appelé quand il a ouvert une session, pour relire
// la personne connectée. Renvoie de quoi arrêter l'écoute.
export function listenToAuthLinks(onSession: () => void): () => void {
  if (Platform.OS === "web") return () => undefined;
  const subscription = Linking.addEventListener("url", ({ url }) => {
    consumeAuthLink(url).then((result) => {
      if (result === "session") onSession();
    }, () => undefined);
  });
  return () => subscription.remove();
}
