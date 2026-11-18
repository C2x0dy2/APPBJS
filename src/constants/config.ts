// L'adresse du serveur de l'application (son API). Toutes les données viennent de là : il n'y a aucune donnée d'exemple.
//
// Elle se règle dans le fichier .env à la racine du projet (voir .env.example) :
//   EXPO_PUBLIC_API_URL=http://localhost:8000
// puis on relance Expo (npx expo start --clear). Sur un téléphone, « localhost » est le téléphone lui-même : il faut y mettre
// l'adresse de l'ordinateur sur le réseau (par exemple http://192.168.1.20:8000).
//
// Sans cette adresse, l'application ne devine rien : elle affiche une erreur de configuration claire (voir services/api.ts).
export const API_URL: string | undefined = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "") || undefined;
