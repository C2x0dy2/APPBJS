import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, onSessionExpired } from "../services/api";
import { Credentials, fetchMe, login, logout, register } from "../services/authservices";
import { getToken } from "../services/session-storage";
import { Role, User } from "../types/user";
import { RegisterForm } from "../utils/validate-auth";

// Qui est connecté ? Le reste de l'app ne lit que "user" : toute la logique de connexion reste dans
// services/authservices.ts, et c'est le serveur qui dit qui est la personne (d'après son jeton).

// Role et User vivent dans types/user.ts ; on les ré-exporte ici pour que les écrans les importent d'un seul endroit.
export type { Role, User };

// loading : on retrouve la session au lancement (la page de lancement reste affichée).
// ready : on sait si quelqu'un est connecté ou non.
// unreachable : le serveur ne répond pas au lancement ; rien ne peut s'afficher sans lui, l'application propose de réessayer.
type Status = "loading" | "ready" | "unreachable";

interface AuthContextValue {
  user: User | null; // null = visiteur, personne n'est connecté
  status: Status;
  startupError: unknown; // pourquoi le lancement a échoué (status = "unreachable")
  retryStartup: () => void;
  signIn: (credentials: Credentials) => Promise<User>; // lève une ApiError si la connexion échoue
  signUp: (form: RegisterForm) => Promise<User>; // idem : l'inscription connecte directement
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>; // relit la personne sur le serveur (par exemple une fois son e-mail vérifié)
  // Un organisateur peut gérer plusieurs collectifs : celui sur lequel il travaille (le premier, tant qu'il n'en choisit pas un autre).
  collectiveId: string | undefined;
  setCollectiveId: (id: string) => void;
}

// Le "Context" permet à n'importe quel écran de lire l'utilisateur
// sans le passer de composant en composant.
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [startupError, setStartupError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [chosenCollectiveId, setChosenCollectiveId] = useState<string | undefined>();

  // Au lancement : s'il y a un jeton gardé sur l'appareil, le serveur dit à qui il appartient.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (await getToken()) {
          const me = await fetchMe();
          if (active) setUser(me);
        }
        if (active) setStatus("ready");
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          setStatus("ready"); // jeton périmé : déjà effacé, la personne est simplement déconnectée
        } else {
          setStartupError(error);
          setStatus("unreachable");
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  // Le serveur refuse le jeton en cours de route (expiré, ou révoqué depuis un autre appareil) : retour à l'état déconnecté.
  useEffect(() => onSessionExpired(() => setUser(null)), []);

  async function startSession(request: Promise<User>): Promise<User> {
    const loggedIn = await request;
    setUser(loggedIn);
    setChosenCollectiveId(undefined);
    return loggedIn; // l'écran sait ainsi où envoyer la personne (acheteur ou organisateur)
  }

  async function signOut() {
    setUser(null); // l'écran change tout de suite ; le serveur révoque le jeton ensuite
    setChosenCollectiveId(undefined);
    await logout();
  }

  // useCallback : les écrans s'en servent dans un effet, il doit rester la même fonction d'un affichage à l'autre.
  const refreshUser = useCallback(async () => {
    setUser(await fetchMe());
  }, []);

  const collectiveId = user?.collectives.find((collective) => collective.id === chosenCollectiveId)?.id ?? user?.collectiveId;

  const value: AuthContextValue = {
    user,
    status,
    startupError,
    retryStartup: () => {
      setStatus("loading");
      setStartupError(null);
      setAttempt((count) => count + 1);
    },
    signIn: (credentials) => startSession(login(credentials)),
    signUp: (form) => startSession(register(form)),
    signOut,
    refreshUser,
    collectiveId,
    setCollectiveId: setChosenCollectiveId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Utilisation dans un écran : const { user, signOut } = useAuth();
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth doit être utilisé à l'intérieur de <AuthProvider>");
  return context;
}
