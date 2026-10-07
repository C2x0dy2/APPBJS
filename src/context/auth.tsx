import { createContext, ReactNode, useContext, useState } from "react";

// Connexion FICTIVE : en attendant le vrai login du backend (email + mot de passe),
// on choisit juste son rôle. Le reste de l'app ne lit que "user" : le jour où le vrai
// login arrive, on ne change que ce fichier.

export type Role = "buyer" | "organizer";

export interface User {
  name: string;
  role: Role;
  collectiveId?: string; // seulement pour un organisateur
}

const FAKE_USERS: Record<Role, User> = {
  buyer: { name: "Awa", role: "buyer" },
  organizer: { name: "Divine", role: "organizer", collectiveId: "col-1" },
};

interface AuthContextValue {
  user: User | null; // null = personne n'est connecté
  signIn: (role: Role) => void;
  signOut: () => void;
}

// Le "Context" permet à n'importe quel écran de lire l'utilisateur
// sans le passer de composant en composant.
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const value: AuthContextValue = {
    user,
    signIn: (role) => setUser(FAKE_USERS[role]),
    signOut: () => setUser(null),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Utilisation dans un écran : const { user, signOut } = useAuth();
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  return context;
}
