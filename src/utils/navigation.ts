import type { Href } from "expo-router";

import { User } from "../types/user";

// La page d'accueil de chaque espace : les acheteurs (et visiteurs) sur "/", les organisateurs sur "/organizer".
export function homeFor(user: User): Href {
  return user.role === "organizer" ? "/organizer" : "/";
}

// Après une connexion, on peut revenir là où la personne était (paramètre "redirect").
// On n'accepte que des adresses de l'app (commençant par un seul "/") : jamais un lien vers l'extérieur.
export function safeRedirect(value?: string | string[]): Href | undefined {
  const target = Array.isArray(value) ? value[0] : value;
  if (target && target.startsWith("/") && !target.startsWith("//")) return target as Href;
  return undefined;
}
