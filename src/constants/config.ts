import Constants from "expo-constants";
import { Platform } from "react-native";

// L'adresse du serveur Django (l'API de l'application). Toutes les données viennent de là : il n'y a aucune donnée d'exemple.
//
//   1. EXPO_PUBLIC_API_URL, dans le fichier .env à la racine du projet (voir .env.example) : toujours prioritaire.
//   2. Sinon, EN DÉVELOPPEMENT SEULEMENT, on la devine : Django tourne sur la même machine que celle qui sert l'application,
//      au port 8000. Sur le web, c'est la machine de la page ; sur téléphone (Expo Go), celle d'où l'application a été chargée.
//   3. En production, sans EXPO_PUBLIC_API_URL, l'application affiche une erreur de configuration : elle n'invente jamais d'adresse.
const DJANGO_PORT = 8000;

function guessDevServerUrl(): string | undefined {
  if (Platform.OS === "web") {
    return typeof window === "undefined" ? undefined : `${window.location.protocol}//${window.location.hostname}:${DJANGO_PORT}`;
  }
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:${DJANGO_PORT}` : undefined;
}

export const API_URL: string | undefined = (process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? guessDevServerUrl() : undefined))?.replace(/\/+$/, "");
