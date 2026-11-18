import { supabase } from "../lib/supabase";
import { CollectiveRole, Role, User } from "../types/user";
import { RegisterForm } from "../utils/validate-auth";
import { ApiError, mapSupabaseError } from "./api";
import { authRedirectUrl } from "./auth-links";

// La connexion, l'inscription, la vérification de l'e-mail et le mot de passe oublié passent par Supabase Auth.
// La connexion se fait par NOM D'UTILISATEUR (pas par e-mail) : supabase.auth ne sait authentifier que par e-mail,
// donc la résolution nom -> e-mail est faite côté serveur par l'Edge Function login-with-username, qui ne renvoie
// que la session obtenue — l'e-mail du compte ne transite jamais jusqu'ici.

export interface Credentials {
  username: string;
  password: string;
}

// Reconstruit le User affiché par l'app à partir de la session Supabase en cours : son profil (nom d'utilisateur)
// et ses adhésions à des collectifs (vide pour un simple acheteur).
async function buildUser(): Promise<User> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new ApiError(401, "not_authenticated", "Connecte-toi pour continuer.");

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
    supabase.from("collective_members").select("collective_id, role, collectives(name)").eq("user_id", user.id),
  ]);

  const collectives = (memberships ?? []).map((m) => ({
    id: m.collective_id as string,
    name: ((m.collectives as unknown as { name: string } | null)?.name ?? "") as string,
    role: m.role as CollectiveRole,
  }));

  const username = profile?.username ?? user.email?.split("@")[0] ?? "";
  const name = (user.user_metadata?.name as string | undefined) || username;
  const role: Role = collectives.length > 0 ? "organizer" : "buyer";

  return {
    id: user.id,
    name,
    username,
    email: user.email ?? "",
    role,
    collectiveId: collectives[0]?.id,
    collectives,
    emailVerified: !!user.email_confirmed_at,
  };
}

export async function login({ username, password }: Credentials): Promise<User> {
  const { data, error } = await supabase.functions.invoke<{ access_token: string; refresh_token: string }>(
    "login-with-username",
    { body: { username: username.trim(), password } }
  );
  if (error || !data) throw new ApiError(401, "invalid_credentials", "Nom d'utilisateur ou mot de passe incorrect.");

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw mapSupabaseError(sessionError);
  return buildUser();
}

// Renvoie la personne connectée, ou null si le projet Supabase exige de confirmer l'adresse e-mail d'abord : dans ce
// cas il n'y a pas encore de session, et se connecter tout de suite serait refusé par Supabase (« Email not
// confirmed », affiché avant comme « mot de passe incorrect » juste après une inscription réussie).
export async function register(form: RegisterForm): Promise<User | null> {
  const { data, error } = await supabase.auth.signUp({
    email: form.email.trim(),
    password: form.password,
    options: {
      // Le lien de confirmation ramène sur l'app (voir services/auth-links.ts).
      emailRedirectTo: authRedirectUrl("/verify-email"),
      data: {
        name: form.username.trim(),
        accepted_terms_at: new Date().toISOString(),
        newsletter: form.newsletter,
      },
    },
  });
  if (error || !data.user) throw mapSupabaseError(error ?? new Error("registration_failed"));

  const { error: profileError } = await supabase.rpc("create_profile", {
    p_user_id: data.user.id,
    p_username: form.username.trim(),
  });
  if (profileError) {
    if (/profiles_username_key|duplicate key/.test(profileError.message)) {
      const taken = "Ce nom d'utilisateur est déjà pris.";
      throw new ApiError(409, "username_taken", taken, { username: taken });
    }
    if (/invalid_username/.test(profileError.message)) {
      const invalid = "Nom d'utilisateur invalide (3 caractères minimum).";
      throw new ApiError(422, "invalid_username", invalid, { username: invalid });
    }
    throw mapSupabaseError(profileError);
  }

  if (!data.session) return null;
  return buildUser();
}

export function fetchMe(): Promise<User> {
  return buildUser();
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

// Même réponse que l'adresse existe ou non (Supabase ne le révèle pas non plus). Le lien reçu ramène sur l'écran
// /reset-password de l'app (avant : aucune adresse de retour, le lien ouvrait la page d'accueil et connectait la
// personne sans jamais lui proposer de nouveau mot de passe).
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: authRedirectUrl("/reset-password"),
  });
  if (error) throw mapSupabaseError(error);
}

// Appelé depuis l'écran ouvert par le lien « mot de passe oublié » (la session de récupération est déjà ouverte,
// voir services/auth-links.ts). Ferme ensuite TOUTES les sessions du compte, celle-ci comprise : la personne se
// reconnecte avec son nouveau mot de passe, et un appareil volé ou oublié est déconnecté.
export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "same_password") {
      const message = "Choisis un mot de passe différent de l'ancien.";
      throw new ApiError(422, code, message, { password: message });
    }
    if (code === "weak_password") {
      const message = "Ce mot de passe est trop faible.";
      throw new ApiError(422, code, message, { password: message });
    }
    if (error.name === "AuthSessionMissingError" || code === "session_not_found") {
      throw new ApiError(401, "invalid_link", "Ce lien n'est plus valide. Demande-en un nouveau.");
    }
    throw mapSupabaseError(error, "Impossible de changer le mot de passe pour le moment. Réessaie dans un instant.");
  }
  await supabase.auth.signOut({ scope: "global" });
}

export async function verifyEmail(token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "email" });
  if (error) throw mapSupabaseError(error);
}

export async function resendVerification(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new ApiError(401, "not_authenticated", "Connecte-toi pour continuer.");
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: user.email,
    options: { emailRedirectTo: authRedirectUrl("/verify-email") },
  });
  if (error) throw mapSupabaseError(error);
}
