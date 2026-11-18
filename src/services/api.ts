import { API_URL } from "../constants/config";
import { clearToken, getToken } from "./session-storage";

// Le client de l'API Django (/api/v1/). Tous les services passent par apiRequest : c'est ici, et seulement ici, qu'on
// envoie le jeton de connexion, qu'on lit les erreurs du serveur et qu'on gère les pannes réseau.

const TIMEOUT_MS = 15_000;

// Une erreur à expliquer à la personne. Le serveur répond toujours { error, message, fields? } : `message` est un texte
// déjà rédigé en français, `fields` une erreur par champ de formulaire ("name", "tickets.0.price"…).
export class ApiError extends Error {
  status: number; // code HTTP ; 0 = aucune réponse du serveur
  code: string; // lisible par le programme : "validation", "sold_out", "email_not_verified", "network"…
  fields: Record<string, string>;
  details: Record<string, unknown>; // précisions du serveur (retryAfterMinutes, ticketTypeId…)

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}, details: Record<string, unknown> = {}) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype); // garde `instanceof` fiable quel que soit le moteur JavaScript
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

// Le texte à afficher pour n'importe quelle erreur (celles du serveur, celles du réseau, et les imprévues).
export function errorMessage(error: unknown, fallback = "Une erreur est survenue. Réessaie dans un instant."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Appelé quand le serveur refuse le jeton (expiré, révoqué) : l'application revient à l'état « déconnecté ».
const expiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown; // envoyé en JSON
  form?: FormData; // ou en formulaire (envoi d'un fichier)
  auth?: boolean; // false : ne jamais envoyer le jeton (lectures publiques, connexion). Par défaut : oui, s'il existe.
  token?: string | null; // jeton à utiliser à la place de celui de l'appareil (déconnexion)
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultMessage(status: number): string {
  if (status >= 500) return "Le serveur rencontre un problème. Réessaie dans un instant.";
  if (status === 404) return "Introuvable.";
  return "La demande a échoué.";
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, form, auth = true, timeoutMs = TIMEOUT_MS } = options;

  if (!API_URL) {
    throw new ApiError(
      0,
      "not_configured",
      "L'adresse du serveur n'est pas configurée. Renseigne EXPO_PUBLIC_API_URL dans le fichier .env, puis relance l'application."
    );
  }

  const token = auth ? (options.token !== undefined ? options.token : await getToken()) : null;
  const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": "fr" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: BodyInit | undefined;
  if (form) {
    payload = form; // pas de Content-Type : le moteur le fixe lui-même, avec la « boundary » du formulaire
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, { method, headers, body: payload, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(0, "timeout", "Le serveur met trop de temps à répondre. Réessaie dans un instant.");
    }
    throw new ApiError(0, "network", "Impossible de joindre le serveur. Vérifie ta connexion, puis réessaie.");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined; // corps vide, ou page HTML d'une panne du serveur
  }

  if (response.ok) return data as T;

  const answer = isRecord(data) ? data : {};
  const code = typeof answer.error === "string" ? answer.error : "server_error";
  const message = typeof answer.message === "string" ? answer.message : defaultMessage(response.status);

  // Le jeton n'est plus valable (la même réponse 401 sert aussi aux mauvais identifiants, mais avec un autre code).
  if (response.status === 401 && code === "unauthorized" && token) {
    await clearToken();
    expiredListeners.forEach((listener) => listener());
  }

  const { error: _error, message: _message, fields, ...details } = answer;
  const fieldErrors: Record<string, string> = {};
  if (isRecord(fields)) {
    for (const [name, text] of Object.entries(fields)) if (typeof text === "string") fieldErrors[name] = text;
  }
  throw new ApiError(response.status, code, message, fieldErrors, details);
}

// Un identifiant inconnu (ou qui n'est pas le nôtre) donne toujours 404 : pour une lecture, c'est « pas trouvé », pas une panne.
export async function orNotFound<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
