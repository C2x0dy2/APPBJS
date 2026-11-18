import { AuthSession, User } from "../types/user";
import { RegisterForm } from "../utils/validate-auth";
import { apiRequest } from "./api";
import { clearToken, getToken, saveToken } from "./session-storage";

// La connexion, l'inscription, la vérification de l'e-mail et le mot de passe oublié : tout passe par le serveur.
// Les erreurs sont des ApiError ; pour un formulaire, `error.fields` donne une erreur par champ.

export interface Credentials {
  username: string;
  password: string;
}

// On garde le jeton reçu : c'est lui qui prouve ensuite qui on est, à chaque requête.
async function startSession(path: string, body: unknown): Promise<User> {
  const session = await apiRequest<AuthSession>(path, { method: "POST", body, auth: false });
  await saveToken(session.token);
  return session.user;
}

export function login({ username, password }: Credentials): Promise<User> {
  return startSession("/auth/login/", { username: username.trim(), password });
}

export function register(form: RegisterForm): Promise<User> {
  return startSession("/auth/register/", {
    username: form.username.trim(),
    email: form.email.trim(),
    password: form.password,
    acceptTerms: form.acceptTerms,
    newsletter: form.newsletter,
  });
}

// La personne connectée, d'après son jeton (au lancement de l'application, ou après avoir vérifié son e-mail).
export function fetchMe(): Promise<User> {
  return apiRequest<User>("/me/");
}

// L'appareil est déconnecté tout de suite ; le serveur révoque ensuite le jeton (au mieux : sans réseau, il expirera de lui-même).
export async function logout(): Promise<void> {
  const token = await getToken();
  await clearToken();
  if (token) await apiRequest("/auth/logout/", { method: "POST", token, timeoutMs: 4000 }).catch(() => undefined);
}

// Même réponse que l'adresse existe ou non : on ne révèle jamais quels e-mails ont un compte.
export async function requestPasswordReset(email: string): Promise<void> {
  await apiRequest("/auth/password-reset/", { method: "POST", body: { email }, auth: false });
}

// Le lien reçu par e-mail donne `uid` et `token`.
export async function confirmPasswordReset(uid: string, token: string, password: string): Promise<void> {
  await apiRequest("/auth/password-reset/confirm/", { method: "POST", body: { uid, token, password }, auth: false });
}

export async function verifyEmail(token: string): Promise<void> {
  await apiRequest("/auth/verify-email/", { method: "POST", body: { token }, auth: false });
}

export async function resendVerification(): Promise<void> {
  await apiRequest("/auth/resend-verification/", { method: "POST" });
}
