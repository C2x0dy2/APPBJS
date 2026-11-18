// Un acheteur achète des billets ; un organisateur gère les événements de son collectif.
export type Role = "buyer" | "organizer";

// Ce qu'une personne peut faire dans un collectif : tout gérer, gérer les événements, ou seulement scanner les billets.
export type CollectiveRole = "admin" | "manager" | "controller";

export interface Collective {
  id: string;
  name: string;
  role: CollectiveRole | null;
}

export interface User {
  id: string;
  name: string; // nom affiché : le prénom s'il existe, sinon le nom d'utilisateur
  username: string; // l'identifiant de connexion
  email: string;
  role: Role;
  collectiveId?: string; // le collectif sur lequel on travaille par défaut ; seulement pour un organisateur
  collectives: Collective[]; // tous les collectifs que la personne gère (vide pour un acheteur)
  emailVerified: boolean; // il faut vérifier son e-mail avant de pouvoir réserver
}

// La réponse à une connexion ou une inscription : le jeton à envoyer ensuite dans chaque requête, et la personne.
export interface AuthSession {
  token: string;
  user: User;
}
